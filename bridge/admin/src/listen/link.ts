// The Listen page's link to the bridge (/listen/ws on the admin page's address): which device it plays
// for, Start and Stop listening, Stop, and the speech it plays. It reconnects by itself, waiting a
// little longer each time. The bridge side is bridge/src/listen.ts; the messages are listed in
// bridge/src/protocol.ts.
import type { Avatar, SpeakOn } from '@/api.ts';
import { PcmPlayer } from './player.ts';

const RETRY_MS = [1000, 2000, 4000, 8000, 15_000];
const CLOSE_SIGNED_OUT = 4001; // the Cloudflare Access login has ended: only a reload signs in again
const DEVICE_KEY = 'grok-puck-listen-device';

export type Role = 'off' | 'here' | 'elsewhere';

export interface PageDevice {
  id: string;
  name: string;
  bot: { name: string; avatar: Avatar } | null;
  online: boolean;
  muted: boolean;
  speak_on: SpeakOn;
  page_ready: boolean; // a Listen page (this one or another) is ready to play its speech
  board: string; // the board it runs on ("" before firmware 0.6.2): where its bot's name goes
  shown_name: string | null; // its bot's name as it shows it under its face (spec §4.3.2); null: none
}

export interface ListenState {
  connection: 'connecting' | 'open' | 'closed' | 'signed-out';
  retryAt: number; // while closed: when it tries again (ms since 1970)
  devices: PageDevice[] | undefined; // undefined until the bridge has answered once
  device: string | null; // the device this page plays for, as the bridge has it
  role: Role; // off: not started · here: it plays · elsewhere: a page started later plays
  shown: string; // what the device shows, "speaking" while the desk speaks anywhere, "listening" while it is held
  playing: boolean; // speech is playing in this tab
  started: boolean; // Start listening was pressed (and not Stop listening since)
  paused: boolean; // started, but the browser has paused this page's sound
  problem: string; // why Start listening didn't work, if it didn't
}

type BridgeMessage =
  | { type: 'status'; devices: PageDevice[]; device: string | null; ready: boolean; role: Role }
  | { type: 'show'; state: string }
  | { type: 'play.start'; id: string; sample_rate: number }
  | { type: 'play.end'; id: string }
  | { type: 'stop' }
  | { type: 'error'; message: string };

export class ListenLink {
  readonly player = new PcmPlayer();
  private state: ListenState = {
    connection: 'connecting',
    retryAt: 0,
    devices: undefined,
    device: null,
    role: 'off',
    shown: 'idle',
    playing: false,
    started: false,
    paused: false,
    problem: '',
  };
  private readonly listeners = new Set<() => void>();
  private socket: WebSocket | undefined;
  private retryTimer: number | undefined;
  private failures = 0;
  private closed = true;
  private wanted: string | null; // the device chosen here: from the address, this browser, or the first one

  constructor() {
    this.wanted = new URLSearchParams(window.location.search).get('device') ?? remembered();
    if (this.wanted) remember(this.wanted);
    this.player.onPlayed = (id) => this.send({ type: 'played', id });
    this.player.onPlaying = (playing) => this.set({ playing });
    this.player.onRunning = (running) => {
      if (!this.state.started) return;
      this.set({ paused: !running });
      // Paused, it can't play: the bridge lets the device speak meanwhile.
      this.send({ type: 'listen', device: this.wanted, ready: running });
    };
  }

  // For React's useSyncExternalStore.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): ListenState => this.state;

  connect(): void {
    this.closed = false;
    window.clearTimeout(this.retryTimer);
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${window.location.host}/listen/ws`);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.set({ connection: 'connecting' });
    socket.onopen = () => {
      this.failures = 0;
      this.set({ connection: 'open' });
      // After a reconnect it is still started, but it doesn't take over from a page started since.
      this.send({ type: 'listen', device: this.wanted, ready: this.ready });
    };
    socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (typeof event.data === 'string') this.onMessage(JSON.parse(event.data) as BridgeMessage);
      else this.player.write(event.data);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.player.stop();
      if (this.closed) return;
      if (event.code === CLOSE_SIGNED_OUT) {
        this.set({ connection: 'signed-out' });
        return;
      }
      const wait = RETRY_MS[Math.min(this.failures, RETRY_MS.length - 1)];
      this.failures++;
      this.set({ connection: 'closed', retryAt: Date.now() + wait });
      this.retryTimer = window.setTimeout(() => this.connect(), wait);
    };
  }

  close(): void {
    this.closed = true;
    window.clearTimeout(this.retryTimer);
    this.socket?.close(1000, 'page closed');
    this.socket = undefined;
  }

  /** Try again now, instead of waiting. */
  retry(): void {
    if (this.state.connection === 'closed') this.connect();
  }

  /** The picker: play for another device. */
  choose(device: string): void {
    this.wanted = device;
    remember(device);
    this.send({ type: 'listen', device, ready: this.ready });
  }

  /** Start listening, or Play here: from a click, so the browser lets the page play sound. */
  async startListening(): Promise<void> {
    let running = false;
    try {
      running = await this.player.unlock();
    } catch {
      running = false;
    }
    if (!running) {
      this.set({ problem: "This browser didn't let the page play sound. Check that sound is allowed for this site, then try again." });
      return;
    }
    this.set({ started: true, paused: false, problem: '' });
    this.send({ type: 'start' });
  }

  /** Stop: the desk stops speaking, here and on the device. */
  stopSpeech(): void {
    this.player.stop();
    this.send({ type: 'stop' });
  }

  /**
   * Stop listening: this page no longer plays the device's speech (what it was playing stops here),
   * the device speaks instead, and Start listening comes back. Unlike Stop, the device carries on.
   */
  stopListening(): void {
    this.player.stop();
    this.set({ started: false, paused: false, problem: '' });
    this.send({ type: 'listen', device: this.wanted, ready: false });
  }

  private get ready(): boolean {
    return this.state.started && this.player.running;
  }

  private onMessage(message: BridgeMessage): void {
    switch (message.type) {
      case 'status': {
        this.set({ devices: message.devices, device: message.device, role: message.role });
        // The device asked for is gone, or none was asked for yet: the first one (with one device,
        // there is nothing to pick).
        const ids = message.devices.map((d) => d.id);
        if (!this.wanted || !ids.includes(this.wanted)) this.wanted = ids[0] ?? null;
        if (this.wanted && this.wanted !== message.device) this.send({ type: 'listen', device: this.wanted, ready: this.ready });
        return;
      }
      case 'show':
        this.set({ shown: message.state });
        return;
      case 'play.start':
        this.player.begin(message.id, message.sample_rate);
        return;
      case 'play.end':
        this.player.end(message.id);
        return;
      case 'stop':
        this.player.stop();
        return;
      case 'error':
        // A message this page sent that the bridge didn't take: nothing the owner can act on.
        return;
    }
  }

  private send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private set(change: Partial<ListenState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
}

// The device picked on this page, kept in this browser. Storage can be missing or refuse (private
// windows), so every access is guarded and the page works without it.
function remembered(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

function remember(device: string): void {
  try {
    localStorage.setItem(DEVICE_KEY, device);
  } catch {
    // not kept; fine
  }
}
