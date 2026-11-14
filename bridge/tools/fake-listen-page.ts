// A stand-in for the Listen page (admin/src/listen/): it speaks the page's WebSocket protocol, so the
// tests can play a device's speech "in a browser tab" without a browser. It plays nothing: it keeps
// what arrives and answers `played` when a clip's audio has all arrived (or when told to).
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { BridgePageMessage, PageDevice, PageRole, PageState } from '../src/protocol.ts';
import type { Played } from './fake-device.ts';

export interface PageStatus {
  devices: PageDevice[];
  device: string | null;
  ready: boolean;
  role: PageRole;
}

export interface FakeListenPageEvents {
  status: [status: PageStatus];
  show: [state: PageState];
  start: [id: string];
  played: [played: Played];
  stopped: [];
  'bridge-error': [message: string];
  closed: [code: number, reason: string];
}

export class FakeListenPage extends EventEmitter<FakeListenPageEvents> {
  readonly url: string;
  status: PageStatus | undefined;
  shown: PageState | undefined;
  /** Every state the bridge asked it to show, in order. */
  readonly asked: PageState[] = [];
  /** Answer `played` as soon as a clip's audio has all arrived. False: only when ack() is called. */
  autoAck = true;
  private readonly origin: string | undefined;
  private readonly headers: Record<string, string>;
  private socket: WebSocket | undefined;
  private device: string | null = null; // the device it plays for, as it last said
  private playing: { id: string; kind: 'speech' | 'tone'; sampleRate: number; chunks: Buffer[] } | undefined;
  private held: Played | undefined;

  /** `origin`: what the browser would send (the page's own address); undefined sends none. */
  constructor(options: { url: string; origin?: string; headers?: Record<string, string> }) {
    super();
    this.url = options.url;
    this.origin = options.origin;
    this.headers = options.headers ?? {};
  }

  /** Resolves once the socket is open and the first status has come; rejects with "HTTP <code>" if refused. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url, { headers: this.headers, ...(this.origin ? { origin: this.origin } : {}) });
      this.socket = socket;
      socket.once('unexpected-response', (_req, res) => {
        reject(new Error(`HTTP ${res.statusCode}`));
        socket.terminate();
      });
      socket.once('error', reject);
      // Refused after opening (too many pages, or the sign-in ended): no status comes.
      const early = (code: number, reason: Buffer) => reject(new Error(`closed: ${code} ${reason.toString()}`));
      socket.once('close', early);
      this.once('status', () => {
        socket.off('close', early);
        resolve();
      });
      socket.on('message', (data, isBinary) => this.onMessage(data as Buffer, isBinary));
      socket.on('close', (code, reason) => this.emit('closed', code, reason.toString()));
    });
  }

  /** Which device it plays for; ready: Start listening was pressed before (after a reconnect). */
  listen(device: string | null, ready = false): void {
    this.device = device;
    this.send({ type: 'listen', device, ready });
  }

  /** Start listening (or Play here). */
  start(): void {
    this.send({ type: 'start' });
  }

  /** Stop listening: it drops what it was playing and is no longer ready, as the page does. */
  stopListening(): void {
    this.playing = undefined;
    this.held = undefined;
    this.send({ type: 'listen', device: this.device, ready: false });
  }

  /** The Stop button. */
  stopSpeech(): void {
    this.playing = undefined;
    this.held = undefined;
    this.send({ type: 'stop' });
  }

  /** Answers `played` for a clip held back while autoAck is off. */
  ack(): void {
    const held = this.held;
    this.held = undefined;
    if (held) this.finish(held);
  }

  sendRaw(text: string): void {
    this.socket?.send(text);
  }

  close(): void {
    this.socket?.close(1000, 'bye');
  }

  private onMessage(data: Buffer, isBinary: boolean): void {
    if (isBinary) {
      this.playing?.chunks.push(Buffer.from(data));
      return;
    }
    const message = JSON.parse(data.toString('utf8')) as BridgePageMessage;
    switch (message.type) {
      case 'status': {
        const { type: _type, ...status } = message;
        this.status = status;
        this.emit('status', status);
        break;
      }
      case 'show':
        this.shown = message.state;
        this.asked.push(message.state);
        this.emit('show', message.state);
        break;
      case 'play.start':
        this.playing = { id: message.id, kind: message.kind, sampleRate: message.sample_rate, chunks: [] };
        this.emit('start', message.id);
        break;
      case 'play.end': {
        const playing = this.playing;
        if (playing?.id !== message.id) break;
        this.playing = undefined;
        const played: Played = { id: playing.id, kind: playing.kind, sampleRate: playing.sampleRate, pcm: Buffer.concat(playing.chunks) };
        if (this.autoAck) this.finish(played);
        else this.held = played;
        break;
      }
      case 'stop':
        this.playing = undefined;
        this.held = undefined;
        this.emit('stopped');
        break;
      case 'error':
        this.emit('bridge-error', message.message);
        break;
    }
  }

  private finish(played: Played): void {
    this.send({ type: 'played', id: played.id });
    this.emit('played', played);
  }

  private send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
