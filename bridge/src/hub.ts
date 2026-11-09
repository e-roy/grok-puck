// Live connections to the devices: approval and keys, what each device shows, what it hears, and
// audio sent to it at the pace it plays.
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import type { Clip } from './clip.ts';
import { hashKey, keyMatches, newKey } from './keys.ts';
import { type BridgeMessage, type DeviceConfig, type DisplayState, type Hello, parseDeviceMessage } from './protocol.ts';
import { DEFAULT_TIMINGS, type Device, type Store } from './store.ts';

const HELLO_TIMEOUT_MS = 10_000;
const PING_MS = 25_000; // keeps the link open through proxies that drop idle connections
const MAX_PENDING = 10; // the device endpoint is public: strangers must not fill the list
const FRAME_BYTES = 4800; // 100 ms of 24 kHz audio
const LEAD_MS = 1000; // how far ahead of real time audio is sent
const MAX_BUFFERED = 256 * 1024;
const MIC_BYTES_PER_MS = 32; // 16 kHz, 16-bit
const MIN_UTTERANCE_BYTES = 3200; // 100 ms

export type PlayResult = 'played' | 'stopped' | 'offline' | 'muted' | 'failed';

export interface HubEvents {
  utterance(device: Device, pcm: Buffer): void;
  connected(device: Device): void;
  /** Nothing is left to play on this device. */
  quiet(device: Device): void;
}

interface Playback {
  id: string;
  abort: AbortController;
  done: () => void;
}

interface Link {
  socket: WebSocket;
  deviceId: string;
  queue: Promise<unknown>;
  queued: number;
  playback: Playback | undefined;
  listening: Buffer[] | undefined;
  listenBytes: number;
  shown: DisplayState;
  alive: boolean;
  pinger: NodeJS.Timeout;
}

export class DeviceHub {
  private readonly store: Store;
  private readonly log: FastifyBaseLogger;
  private readonly events: HubEvents;
  private readonly links = new Map<string, Link>();
  private readonly waiting = new Map<string, WebSocket>(); // pending devices, until approved

  constructor(store: Store, log: FastifyBaseLogger, events: HubEvents) {
    this.store = store;
    this.log = log;
    this.events = events;
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

  isOnline(id: string): boolean {
    return this.links.has(id);
  }

  /** Pending and connected, so it can be approved now. */
  isWaiting(id: string): boolean {
    return this.waiting.get(id)?.readyState === 1;
  }

  shown(id: string): DisplayState | undefined {
    return this.links.get(id)?.shown;
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
    this.store.state.devices = this.store.state.devices.filter((d) => d.id !== id);
    this.store.changed();
  }

  /** Tells an online device to forget its Wi-Fi and open its setup network. False if it is offline. */
  forgetWifi(id: string): boolean {
    const link = this.links.get(id);
    if (!link) return false;
    this.send(link.socket, { type: 'wifi.forget' });
    return true;
  }

  sendConfig(device: Device): void {
    const link = this.links.get(device.id);
    if (link) this.send(link.socket, this.configFor(device));
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

  show(id: string, state: DisplayState): void {
    const link = this.links.get(id);
    if (!link) return;
    link.shown = state;
    this.send(link.socket, { type: 'show', state });
  }

  /** Plays a clip after whatever is already playing on that device. */
  play(id: string, clip: Clip, kind: 'speech' | 'tone'): Promise<PlayResult> {
    const link = this.links.get(id);
    if (!link) return Promise.resolve('offline');
    if (this.store.device(id)?.muted) return Promise.resolve('muted');
    link.queued++;
    const result = link.queue
      .then(() => this.stream(link, clip, kind))
      .catch((err: unknown): PlayResult => {
        this.log.warn({ err, device: id }, 'playback failed');
        return 'failed';
      });
    link.queue = result.finally(() => {
      link.queued--;
      const device = this.store.device(id);
      if (link.queued === 0 && this.links.get(id) === link && device) this.events.quiet(device);
    });
    return result;
  }

  closeAll(): void {
    for (const link of this.links.values()) {
      this.drop(link);
      link.socket.close(1001, 'bridge stopping');
    }
    for (const socket of this.waiting.values()) socket.close(1001, 'bridge stopping');
    this.waiting.clear();
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
        timings: { ...DEFAULT_TIMINGS },
        firmware: hello.firmware,
        firstSeen: now,
        lastSeen: now,
      };
      this.store.state.devices.push(device);
      this.store.addHistory({ kind: 'device', ok: true, deviceId: device.id, detail: 'new device, waiting for approval' });
    }
    device.firmware = hello.firmware;
    device.lastSeen = now;
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
      queue: Promise.resolve(),
      queued: 0,
      playback: undefined,
      listening: undefined,
      listenBytes: 0,
      shown: 'idle',
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
        link.playback?.abort.abort(); // the device stops speaking when it starts listening
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
        if (link.playback?.id === message.id) {
          if (message.stopped) link.playback.abort.abort();
          link.playback.done();
        }
        return;
      case 'stop':
        link.playback?.abort.abort();
        link.playback?.done();
        return;
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
      this.show(device.id, link.shown === 'error' ? 'idle' : link.shown);
      return;
    }
    this.events.utterance(device, pcm.subarray(0, pcm.length & ~1));
  }

  private async stream(link: Link, clip: Clip, kind: 'speech' | 'tone'): Promise<PlayResult> {
    if (this.links.get(link.deviceId) !== link) return 'offline';
    const abort = new AbortController();
    let done!: () => void;
    const finished = new Promise<void>((resolve) => {
      done = resolve;
    });
    const playback: Playback = { id: randomUUID().slice(0, 8), abort, done };
    link.playback = playback;
    const bytesPerMs = (clip.sampleRate * 2) / 1000;
    const started = performance.now();
    let sent = 0;
    this.send(link.socket, { type: 'play.start', id: playback.id, sample_rate: clip.sampleRate, format: 'pcm_s16le', kind });
    try {
      let carry: Buffer = Buffer.alloc(0);
      for await (const chunk of clip.read()) {
        carry = carry.length ? Buffer.concat([carry, chunk]) : chunk;
        while (carry.length >= FRAME_BYTES && (await this.pace(link, started, sent / bytesPerMs, abort))) {
          link.socket.send(carry.subarray(0, FRAME_BYTES));
          sent += FRAME_BYTES;
          carry = carry.subarray(FRAME_BYTES);
        }
        if (abort.signal.aborted) break;
      }
      const rest = carry.length & ~1;
      if (!abort.signal.aborted && rest > 0 && link.socket.readyState === link.socket.OPEN) {
        link.socket.send(carry.subarray(0, rest));
        sent += rest;
      }
    } finally {
      this.send(link.socket, { type: 'play.end', id: playback.id });
    }
    if (!abort.signal.aborted) {
      // Wait until the device has played what it still holds (it answers `played`).
      const left = sent / bytesPerMs - (performance.now() - started);
      await Promise.race([finished, sleep(Math.max(0, left) + 3000)]);
    }
    if (link.playback === playback) link.playback = undefined;
    return abort.signal.aborted ? 'stopped' : 'played';
  }

  /** Waits until the next frame is due. False when playback should stop. */
  private async pace(link: Link, started: number, audioMs: number, abort: AbortController): Promise<boolean> {
    for (;;) {
      if (abort.signal.aborted) return false;
      if (link.socket.readyState !== link.socket.OPEN) {
        abort.abort();
        return false;
      }
      const ahead = audioMs - (performance.now() - started);
      if (ahead <= LEAD_MS && link.socket.bufferedAmount < MAX_BUFFERED) return true;
      await sleep(Math.min(50, Math.max(5, ahead - LEAD_MS)));
    }
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
    this.log.info({ device: id }, 'device disconnected');
  }

  private drop(link: Link): void {
    clearInterval(link.pinger);
    link.playback?.abort.abort();
    link.playback?.done();
    if (this.links.get(link.deviceId) === link) this.links.delete(link.deviceId);
  }

  private send(socket: WebSocket, message: BridgeMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
