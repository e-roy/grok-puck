// Live connections to the devices and the Listen pages: approval and keys, what each device shows,
// what it hears, and its speech, sent to the device, to a Listen page or to both, at the pace it plays.
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import type { Clip } from './clip.ts';
import { hashKey, keyMatches, newKey } from './keys.ts';
import { ListenPages } from './listen.ts';
import {
  type BridgeMessage,
  type DeviceConfig,
  type DisplayState,
  FEATURE_SPEAKING,
  type Hello,
  parseDeviceMessage,
  type ShownState,
  type WifiReport,
} from './protocol.ts';
import { DEFAULT_TIMINGS, type Device, type Store } from './store.ts';

const HELLO_TIMEOUT_MS = 10_000;
const PING_MS = 25_000; // keeps the link open through proxies that drop idle connections
const MAX_PENDING = 10; // the device endpoint is public: strangers must not fill the list
const FRAME_BYTES = 4800; // 100 ms of 24 kHz audio
const LEAD_MS = 1000; // how far ahead of real time audio is sent
const MAX_BUFFERED = 256 * 1024;
const MIC_BYTES_PER_MS = 32; // 16 kHz, 16-bit
const MIN_UTTERANCE_BYTES = 3200; // 100 ms

/**
 * played: it played to the end somewhere · stopped: the owner stopped it (or every place it played
 * on dropped out) · offline: there was nowhere to play it · muted · failed: its audio couldn't be made.
 */
export type PlayResult = 'played' | 'stopped' | 'offline' | 'muted' | 'failed';

/** Where a clip plays: on the device, on its Listen page, or on both. */
export type Place = 'device' | 'page' | 'both';

export interface HubEvents {
  utterance(device: Device, pcm: Buffer): void;
  connected(device: Device): void;
  /** Nothing is left to play for this device, anywhere. */
  quiet(device: Device): void;
  /** A Listen page now plays for this device. */
  pageReady(device: Device): void;
}

/** One place a clip plays on: the device's socket or a Listen page's. */
interface Output {
  where: 'device' | 'page';
  socket: WebSocket;
  abort: AbortController; // this place stops: its socket closed, or the clip was stopped
  done: () => void; // it answered `played`
  finished: boolean; // it played the clip to the end
}

/** A clip playing: the same audio, in step, on each of its places. */
interface Turn {
  id: string;
  outputs: Output[];
  stopped: boolean; // the owner stopped it: on the device, on a Listen page, or by muting
}

/** A device's speech, wherever it plays: one clip at a time, in order. */
interface Speaker {
  queue: Promise<unknown>;
  queued: number;
  turn: Turn | undefined;
  onPage: boolean; // the clip playing (or the last one, until nothing is queued) plays on a Listen page
}

interface Link {
  socket: WebSocket;
  deviceId: string;
  listening: Buffer[] | undefined;
  listenBytes: number;
  alive: boolean;
  pinger: NodeJS.Timeout;
}

export class DeviceHub {
  private readonly store: Store;
  private readonly log: FastifyBaseLogger;
  private readonly events: HubEvents;
  private readonly links = new Map<string, Link>();
  private readonly waiting = new Map<string, WebSocket>(); // pending devices, until approved
  private readonly speakers = new Map<string, Speaker>();
  private readonly resting = new Map<string, DisplayState>(); // what the desk last asked each device to show
  private readonly pages: ListenPages;

  constructor(store: Store, log: FastifyBaseLogger, events: HubEvents) {
    this.store = store;
    this.log = log;
    this.events = events;
    this.pages = new ListenPages(
      store,
      log,
      { online: (id) => this.links.has(id), shown: (id) => this.pageShown(id) },
      {
        played: (page, id, stopped) => this.onPlayed(page.socket, id, stopped),
        stop: (page) => {
          if (page.deviceId) this.stopTurn(page.deviceId, page.socket);
        },
        ready: (id) => {
          const device = this.store.device(id);
          if (device) this.events.pageReady(device);
        },
        released: (page) => this.release(page.socket),
      },
    );
  }

  accept(socket: WebSocket): void {
    let deviceId: string | undefined;
    const helloTimer = setTimeout(() => socket.close(4000, 'hello expected'), HELLO_TIMEOUT_MS);
    socket.on('message', (data: RawData, isBinary: boolean) => {
      const link = deviceId ? this.links.get(deviceId) : undefined;
      const mine = link?.socket === socket ? link : undefined;
      if (isBinary) {
        if (mine) this.onAudio(mine, toBuffer(data));
        return;
      }
      const text = toBuffer(data).toString('utf8');
      if (mine) {
        this.onMessage(mine, text);
        return;
      }
      if (deviceId) return; // pending: nothing to do until approved
      const hello = parseDeviceMessage(text);
      if (hello?.type !== 'hello') {
        socket.close(4000, 'hello expected');
        return;
      }
      clearTimeout(helloTimer);
      deviceId = hello.device_id;
      this.onHello(socket, hello);
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (deviceId) this.onClose(deviceId, socket);
    });
    socket.on('error', (err) => this.log.warn({ err, device: deviceId }, 'device socket error'));
  }

  /** A Listen page's socket, already checked. `expires`: when its login ends. */
  acceptPage(socket: WebSocket, expires?: number): void {
    this.pages.accept(socket, expires);
  }

  isOnline(id: string): boolean {
    return this.links.has(id);
  }

  /** Pending and connected, so it can be approved now. */
  isWaiting(id: string): boolean {
    return this.waiting.get(id)?.readyState === 1;
  }

  /** What an online device shows (as far as the bridge decides it). */
  shown(id: string): ShownState | undefined {
    return this.links.has(id) ? this.deviceShown(id) : undefined;
  }

  /** Where this device's speech plays right now, if it is speaking. */
  speaking(id: string): Place | null {
    const outputs = this.speakers.get(id)?.turn?.outputs.filter((o) => !o.abort.signal.aborted) ?? [];
    const device = outputs.some((o) => o.where === 'device');
    const page = outputs.some((o) => o.where === 'page');
    return device && page ? 'both' : device ? 'device' : page ? 'page' : null;
  }

  /** Its Listen pages: how many are open, and whether one is ready to play. */
  listenSummary(id: string): { open: number; ready: boolean } {
    return this.pages.summary(id);
  }

  /**
   * Where a clip for this device would play now: Speak on, with the Listen page only when one is
   * ready (otherwise the device speaks, so nothing is lost). Null: nowhere (offline, no page).
   */
  route(id: string): Place | null {
    const device = this.store.device(id);
    if (!device) return null;
    const online = this.links.has(id);
    if (device.speakOn !== 'device' && this.pages.active(id)) return online && device.speakOn === 'both' ? 'both' : 'page';
    return online ? 'device' : null;
  }

  /** Approves a waiting device and sends it its key. Returns why it can't, or null. */
  approve(id: string, changes: { botId?: string; name?: string }): string | null {
    const device = this.store.device(id);
    if (!device) return 'unknown device';
    if (device.status !== 'pending') return 'this device is already approved';
    const socket = this.waiting.get(id);
    if (!socket || socket.readyState !== socket.OPEN) {
      return 'the device must be online to approve it: it receives its key at that moment';
    }
    const key = newKey();
    device.status = 'approved';
    device.keyHash = hashKey(key);
    if (changes.botId !== undefined) device.botId = changes.botId;
    if (changes.name) device.name = changes.name;
    this.store.changed();
    this.waiting.delete(id);
    this.send(socket, { type: 'welcome', key });
    this.link(device, socket);
    return null;
  }

  /** Removes a device; it has to be approved again. */
  forget(id: string): void {
    const waiting = this.waiting.get(id);
    this.waiting.delete(id);
    waiting?.close(4004, 'forgotten');
    const link = this.links.get(id);
    if (link) {
      this.drop(link);
      link.socket.close(4004, 'forgotten');
    }
    this.stopTurn(id);
    this.speakers.delete(id);
    this.resting.delete(id);
    this.store.state.devices = this.store.state.devices.filter((d) => d.id !== id);
    this.store.changed();
    this.pages.changed();
  }

  /** Tells an online device to forget all its Wi-Fi networks and restart into setup. False if it is offline. */
  forgetWifi(id: string): boolean {
    const link = this.links.get(id);
    if (!link) return false;
    this.send(link.socket, { type: 'wifi.forget' });
    return true;
  }

  /** Tells an online device to open its setup network for a while. Returns why it can't, or null. */
  openWifiSetup(id: string): string | null {
    const problem = this.wifiProblem(id);
    if (problem) return problem;
    this.send(this.links.get(id)!.socket, { type: 'wifi.setup' });
    return null;
  }

  /** Tells an online device to forget one of its saved networks. Returns why it can't, or null. */
  forgetNetwork(id: string, ssid: string): string | null {
    const problem = this.wifiProblem(id);
    if (problem) return problem;
    if (!this.store.device(id)?.wifi?.saved.includes(ssid)) return 'this device has no saved network by that name';
    this.send(this.links.get(id)!.socket, { type: 'wifi.forget_network', ssid });
    return null;
  }

  private wifiProblem(id: string): string | null {
    if (!this.links.has(id)) return 'the device must be online to receive this';
    // Older firmware doesn't report its networks, and doesn't know these messages either.
    if (!this.store.device(id)?.wifi) return "this device's firmware can't do this: firmware 0.6.0 or later can";
    return null;
  }

  /** After a change to the device or its bot: its config to the device, and the news to the Listen pages. */
  sendConfig(device: Device): void {
    const link = this.links.get(device.id);
    if (link) this.send(link.socket, this.configFor(device));
    this.pages.changed();
  }

  configFor(device: Device): DeviceConfig {
    const bot = this.store.bot(device.botId);
    return {
      type: 'config',
      name: device.name,
      bot: bot ? { name: bot.name, avatar: bot.avatar } : null,
      volume: device.volume,
      muted: device.muted,
      timings: device.timings,
    };
  }

  /** The state to show between clips (what the bot is doing). While a Listen page plays, the device shows "speaking". */
  show(id: string, state: DisplayState): void {
    this.resting.set(id, state);
    this.sendShown(id);
  }

  /** Plays a clip after whatever is already playing for that device, where `route()` says when its turn comes. */
  play(id: string, clip: Clip, kind: 'speech' | 'tone', planned: Place | null = this.route(id)): Promise<PlayResult> {
    if (!this.store.device(id)) return Promise.resolve('offline');
    if (this.store.device(id)?.muted) return Promise.resolve('muted');
    if (!planned) return Promise.resolve('offline');
    let speaker = this.speakers.get(id);
    if (!speaker) {
      speaker = { queue: Promise.resolve(), queued: 0, turn: undefined, onPage: false };
      this.speakers.set(id, speaker);
    }
    const mine = speaker;
    mine.queued++;
    const result = mine.queue
      .then(() => this.playTurn(id, mine, clip, kind, planned))
      .catch((err: unknown): PlayResult => {
        this.log.warn({ err, device: id }, 'playback failed');
        return 'failed';
      });
    mine.queue = result.finally(() => {
      mine.queued--;
      if (mine.queued > 0 || this.speakers.get(id) !== mine) return;
      mine.onPage = false;
      const device = this.store.device(id);
      if (device) this.events.quiet(device);
    });
    return result;
  }

  /** Stops what this device is saying, everywhere (muting does this). */
  stopSpeech(id: string): void {
    this.stopTurn(id);
  }

  closeAll(): void {
    for (const link of this.links.values()) {
      this.drop(link);
      link.socket.close(1001, 'bridge stopping');
    }
    for (const socket of this.waiting.values()) socket.close(1001, 'bridge stopping');
    this.waiting.clear();
    this.pages.closeAll();
  }

  private onHello(socket: WebSocket, hello: Hello): void {
    const now = new Date().toISOString();
    let device = this.store.device(hello.device_id);
    if (!device) {
      const pending = this.store.state.devices.filter((d) => d.status === 'pending').length;
      if (pending >= MAX_PENDING) {
        this.send(socket, { type: 'error', message: 'too many devices are waiting for approval' });
        socket.close(4003, 'too many devices waiting');
        return;
      }
      device = {
        id: hello.device_id,
        name: hello.device_id,
        status: 'pending',
        keyHash: '',
        botId: '',
        volume: 70,
        muted: false,
        speakOn: 'device',
        timings: { ...DEFAULT_TIMINGS },
        firmware: hello.firmware,
        features: [],
        firstSeen: now,
        lastSeen: now,
      };
      this.store.state.devices.push(device);
      this.store.addHistory({ kind: 'device', ok: true, deviceId: device.id, detail: 'new device, waiting for approval' });
    }
    device.firmware = hello.firmware;
    device.features = hello.features ?? []; // none from firmware before 0.6.1
    device.lastSeen = now;
    setWifi(device, hello.wifi, now); // none from older firmware: its card shows no Wi-Fi part
    this.store.changed();

    if (device.status === 'pending') {
      const old = this.waiting.get(device.id);
      if (old && old !== socket) old.close(4002, 'replaced by a new connection');
      this.waiting.set(device.id, socket);
      this.send(socket, { type: 'pending', device_id: device.id });
      return;
    }
    if (!keyMatches(hello.key, device.keyHash)) {
      this.send(socket, { type: 'error', message: 'unknown device key: forget the device in the admin page and approve it again' });
      socket.close(4001, 'unknown device key');
      return;
    }
    this.link(device, socket);
  }

  private link(device: Device, socket: WebSocket): void {
    const old = this.links.get(device.id);
    if (old && old.socket !== socket) {
      this.drop(old);
      old.socket.close(4002, 'replaced by a new connection');
    }
    const link: Link = {
      socket,
      deviceId: device.id,
      listening: undefined,
      listenBytes: 0,
      alive: true,
      pinger: setInterval(() => {
        if (!link.alive) {
          socket.terminate();
          return;
        }
        link.alive = false;
        socket.ping();
      }, PING_MS),
    };
    socket.on('pong', () => {
      link.alive = true;
    });
    this.links.set(device.id, link);
    this.send(socket, this.configFor(device));
    this.log.info({ device: device.id }, 'device connected');
    this.pages.changed();
    this.events.connected(device);
  }

  private onMessage(link: Link, text: string): void {
    const message = parseDeviceMessage(text);
    if (!message) {
      this.send(link.socket, { type: 'error', message: 'unrecognised message' });
      return;
    }
    switch (message.type) {
      case 'listen.start':
        // Holding the screen stops speech wherever it plays; the device has stopped its own already.
        this.stopTurn(link.deviceId, link.socket);
        link.listening = [];
        link.listenBytes = 0;
        return;
      case 'listen.end':
        this.finishListening(link);
        return;
      case 'listen.cancel':
        link.listening = undefined;
        return;
      case 'played':
        this.onPlayed(link.socket, message.id, message.stopped);
        return;
      case 'stop':
        // A tap: speech stops wherever it plays.
        this.stopTurn(link.deviceId, link.socket);
        return;
      case 'wifi': {
        const device = this.store.device(link.deviceId);
        if (!device) return;
        const { type: _type, ...report } = message;
        setWifi(device, report, new Date().toISOString());
        this.store.changed();
        return;
      }
      case 'hello':
      case 'state':
        return;
    }
  }

  private onAudio(link: Link, data: Buffer): void {
    if (!link.listening) return;
    link.listening.push(data);
    link.listenBytes += data.length;
    const maxMs = this.store.device(link.deviceId)?.timings.maxListenMs ?? DEFAULT_TIMINGS.maxListenMs;
    if (link.listenBytes > (maxMs + 3000) * MIC_BYTES_PER_MS) {
      this.log.warn({ device: link.deviceId }, 'listening ran past its limit; using what was heard');
      this.finishListening(link);
    }
  }

  private finishListening(link: Link): void {
    const chunks = link.listening;
    link.listening = undefined;
    const device = this.store.device(link.deviceId);
    if (!chunks || !device) return;
    const pcm = Buffer.concat(chunks);
    if (pcm.length < MIN_UTTERANCE_BYTES) {
      // Nothing to send: the device guessed "thinking", so it is told again what to show.
      const resting = this.resting.get(device.id) ?? 'idle';
      this.show(device.id, resting === 'error' ? 'idle' : resting);
      return;
    }
    this.events.utterance(device, pcm.subarray(0, pcm.length & ~1));
  }

  // ---- speech: one clip at a time per device, on the device, its Listen page, or both ----

  private async playTurn(id: string, speaker: Speaker, clip: Clip, kind: 'speech' | 'tone', planned: Place): Promise<PlayResult> {
    const device = this.store.device(id);
    if (!device) return 'offline';
    if (device.muted) return 'muted'; // muted while it waited
    // Decided again now: a Listen page may have opened or closed, or the device dropped, meanwhile.
    const place = this.route(id);
    if (!place) return 'offline';
    if (place !== planned && kind === 'speech') {
      this.store.addHistory({
        kind: 'say',
        ok: true,
        deviceId: id,
        detail: `Played on ${placeText(place, device.name)} rather than ${placeText(planned, device.name)}: that changed while the clip waited its turn.`,
      });
    }
    const turn: Turn = { id: randomUUID().slice(0, 8), outputs: [], stopped: false };
    const link = this.links.get(id);
    if (place !== 'page' && link) turn.outputs.push(output('device', link.socket));
    const page = place === 'device' ? undefined : this.pages.active(id);
    if (page) turn.outputs.push(output('page', page.socket));
    speaker.turn = turn;
    speaker.onPage = page !== undefined;
    this.sendShown(id); // pages show "speaking"; so does the device, while a page plays
    try {
      const streams = await Promise.allSettled(turn.outputs.map((o) => this.stream(o, turn.id, clip, kind)));
      const failed = streams.find((s) => s.status === 'rejected');
      if (failed) throw failed.reason;
    } finally {
      if (speaker.turn === turn) speaker.turn = undefined;
    }
    if (turn.stopped) return 'stopped';
    return turn.outputs.some((o) => o.finished) ? 'played' : 'stopped';
  }

  /** Sends the clip to one place, paced, then waits until that place has played what it holds. */
  private async stream(out: Output, id: string, clip: Clip, kind: 'speech' | 'tone'): Promise<void> {
    let resolveDone!: () => void;
    const answered = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    out.done = resolveDone;
    const { socket, abort } = out;
    const bytesPerMs = (clip.sampleRate * 2) / 1000;
    const started = performance.now();
    let sent = 0;
    this.send(socket, { type: 'play.start', id, sample_rate: clip.sampleRate, format: 'pcm_s16le', kind });
    try {
      let carry: Buffer = Buffer.alloc(0);
      for await (const chunk of clip.read()) {
        carry = carry.length ? Buffer.concat([carry, chunk]) : chunk;
        while (carry.length >= FRAME_BYTES && (await this.pace(socket, started, sent / bytesPerMs, abort))) {
          socket.send(carry.subarray(0, FRAME_BYTES));
          sent += FRAME_BYTES;
          carry = carry.subarray(FRAME_BYTES);
        }
        if (abort.signal.aborted) break;
      }
      const rest = carry.length & ~1;
      if (!abort.signal.aborted && rest > 0 && socket.readyState === socket.OPEN) {
        socket.send(carry.subarray(0, rest));
        sent += rest;
      }
    } finally {
      this.send(socket, { type: 'play.end', id });
    }
    if (abort.signal.aborted) return;
    // Wait until it has played what it still holds (it answers `played`).
    const left = sent / bytesPerMs - (performance.now() - started);
    await Promise.race([answered, sleep(Math.max(0, left) + 3000)]);
    if (!abort.signal.aborted) out.finished = true;
  }

  /** Waits until the next frame is due. False when this place should stop. */
  private async pace(socket: WebSocket, started: number, audioMs: number, abort: AbortController): Promise<boolean> {
    for (;;) {
      if (abort.signal.aborted) return false;
      if (socket.readyState !== socket.OPEN) {
        abort.abort();
        return false;
      }
      const ahead = audioMs - (performance.now() - started);
      if (ahead <= LEAD_MS && socket.bufferedAmount < MAX_BUFFERED) return true;
      await sleep(Math.min(50, Math.max(5, ahead - LEAD_MS)));
    }
  }

  /** The owner stopped speech (`from` is where, which has stopped already): it stops everywhere. */
  private stopTurn(id: string, from?: WebSocket): void {
    const turn = this.speakers.get(id)?.turn;
    if (!turn || turn.stopped) return;
    turn.stopped = true;
    for (const out of turn.outputs) {
      if (out.socket !== from && !out.abort.signal.aborted) this.send(out.socket, { type: 'stop' });
      out.abort.abort();
      out.done();
    }
  }

  /** A place answered `played` for a clip it was sent. */
  private onPlayed(socket: WebSocket, clipId: string, stopped: boolean): void {
    for (const [id, speaker] of this.speakers) {
      const out = speaker.turn?.id === clipId ? speaker.turn.outputs.find((o) => o.socket === socket) : undefined;
      if (!out) continue;
      if (stopped) this.stopTurn(id, socket);
      else out.done();
      return;
    }
  }

  /** A socket that no longer plays (it closed, or its page moved on): its part of a clip ends; the others go on. */
  private release(socket: WebSocket): void {
    for (const speaker of this.speakers.values()) {
      for (const out of speaker.turn?.outputs ?? []) {
        if (out.socket !== socket || out.abort.signal.aborted) continue;
        if (socket.readyState === socket.OPEN) this.send(out.socket, { type: 'stop' });
        out.abort.abort();
        out.done();
      }
    }
  }

  // ---- what the device and its Listen pages show ----

  private deviceShown(id: string): ShownState {
    const resting = this.resting.get(id) ?? 'idle';
    // Firmware before 0.6.1 can't show "speaking" without playing: it keeps its resting state.
    const canShow = this.store.device(id)?.features.includes(FEATURE_SPEAKING) ?? false;
    return this.speakers.get(id)?.onPage && canShow ? 'speaking' : resting;
  }

  private pageShown(id: string): ShownState {
    const speaker = this.speakers.get(id);
    return speaker?.turn || speaker?.onPage ? 'speaking' : (this.resting.get(id) ?? 'idle');
  }

  private sendShown(id: string): void {
    const link = this.links.get(id);
    if (link) this.send(link.socket, { type: 'show', state: this.deviceShown(id) });
    this.pages.show(id, this.pageShown(id));
  }

  private onClose(id: string, socket: WebSocket): void {
    if (this.waiting.get(id) === socket) this.waiting.delete(id);
    const link = this.links.get(id);
    if (link?.socket !== socket) return;
    this.drop(link);
    const device = this.store.device(id);
    if (device) {
      device.lastSeen = new Date().toISOString();
      this.store.changed();
    }
    this.pages.changed();
    this.log.info({ device: id }, 'device disconnected');
  }

  private drop(link: Link): void {
    clearInterval(link.pinger);
    this.release(link.socket);
    if (this.links.get(link.deviceId) === link) this.links.delete(link.deviceId);
  }

  private send(socket: WebSocket, message: BridgeMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}

function output(where: 'device' | 'page', socket: WebSocket): Output {
  return { where, socket, abort: new AbortController(), done: () => undefined, finished: false };
}

/** "Desk", "the Listen page for Desk", "Desk and its Listen page". */
export function placeText(place: Place, name: string): string {
  if (place === 'page') return `the Listen page for ${name}`;
  return place === 'both' ? `${name} and its Listen page` : name;
}

function setWifi(device: Device, report: WifiReport | undefined, at: string): void {
  if (report) device.wifi = { ...report, at };
  else delete device.wifi;
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
