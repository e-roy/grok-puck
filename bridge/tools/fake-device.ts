// A stand-in for the desk device. It speaks the device protocol, so the bridge can be tried without
// hardware.
//
//   pnpm fake-device [--url ws://127.0.0.1:8787/device] [--id fake-desk-01] [--play]
//                    [--networks "Home Wi-Fi,Phone hotspot"] [--old-firmware]
//
// Then type `talk` (a short tone as the "voice"), `talk some.wav` (16 kHz mono 16-bit WAV),
// `stop` (stop speech), `signal -70` (its Wi-Fi signal, in dBm) or `quit`. What the bridge plays is
// saved as WAV files in .fake/out/ (and played with ffplay when --play is given). The device key is
// kept in .fake/<id>.key. It reports its saved Wi-Fi networks (the first one in use), as firmware
// 0.6.0 does, unless --old-firmware is given.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';
import { MIC_RATE, readWav, tones, wav } from '../src/audio.ts';
import type { BridgeMessage, DeviceConfig, DisplayState, WifiReport } from '../src/protocol.ts';

const SETUP_MS = 600_000; // how long the device keeps a requested setup network open

export interface Played {
  id: string;
  kind: 'speech' | 'tone';
  sampleRate: number;
  pcm: Buffer;
}

export interface FakeDeviceEvents {
  pending: [];
  welcome: [key: string];
  config: [config: DeviceConfig];
  show: [state: DisplayState];
  played: [played: Played];
  'forget-wifi': [];
  'forget-network': [ssid: string];
  'wifi-setup': [];
  'bridge-error': [message: string];
  closed: [code: number, reason: string];
}

export class FakeDevice extends EventEmitter<FakeDeviceEvents> {
  readonly id: string;
  readonly url: string;
  key: string | undefined;
  /** Its Wi-Fi as it reports it; undefined acts like firmware older than 0.6.0, which reports none. */
  wifi: WifiReport | undefined;
  /** Acknowledge a clip only after its duration, like a real speaker. */
  realtime = false;
  private socket: WebSocket | undefined;
  private playing: { id: string; kind: 'speech' | 'tone'; sampleRate: number; started: number; chunks: Buffer[] } | undefined;

  constructor(options: { url: string; id: string; key?: string; networks?: string[] }) {
    super();
    this.url = options.url;
    this.id = options.id;
    this.key = options.key;
    if (options.networks) {
      const saved = options.networks.slice(0, 5);
      this.wifi = { saved, current: saved[0] ?? null, rssi: saved.length ? -58 : null, setup: false };
    }
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.once('open', () => {
        const firmware = this.wifi ? 'fake-device/0.6' : 'fake-device/0.5';
        this.send({
          type: 'hello',
          device_id: this.id,
          firmware,
          ...(this.key ? { key: this.key } : {}),
          ...(this.wifi ? { wifi: this.wifi } : {}),
        });
        resolve();
      });
      socket.once('error', reject);
      socket.on('message', (data, isBinary) => this.onMessage(data as Buffer, isBinary));
      socket.on('close', (code, reason) => this.emit('closed', code, reason.toString()));
    });
  }

  /** Sends audio as the microphone would: listen.start, 100 ms frames, listen.end. */
  async talk(pcm: Buffer, options: { realtime?: boolean } = {}): Promise<void> {
    this.send({ type: 'listen.start', sample_rate: MIC_RATE });
    const frame = (MIC_RATE * 2) / 10;
    for (let at = 0; at < pcm.length; at += frame) {
      this.socket?.send(pcm.subarray(at, at + frame));
      if (options.realtime) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.send({ type: 'listen.end' });
  }

  stopSpeech(): void {
    this.playing = undefined;
    this.send({ type: 'stop' });
  }

  /** Changes what it reports about its Wi-Fi, and tells the bridge, as the firmware does. */
  updateWifi(change: Partial<WifiReport>): void {
    if (!this.wifi) return;
    this.wifi = { ...this.wifi, ...change };
    this.send({ type: 'wifi', ...this.wifi });
  }

  close(): void {
    this.socket?.close(1000, 'bye');
  }

  private onMessage(data: Buffer, isBinary: boolean): void {
    if (isBinary) {
      this.playing?.chunks.push(Buffer.from(data));
      return;
    }
    const message = JSON.parse(data.toString('utf8')) as BridgeMessage;
    switch (message.type) {
      case 'pending':
        this.emit('pending');
        break;
      case 'welcome':
        this.key = message.key;
        this.emit('welcome', message.key);
        break;
      case 'config':
        this.emit('config', message);
        break;
      case 'show':
        this.emit('show', message.state);
        break;
      case 'play.start':
        this.playing = { id: message.id, kind: message.kind, sampleRate: message.sample_rate, started: Date.now(), chunks: [] };
        break;
      case 'play.end':
        this.finishPlaying(message.id);
        break;
      case 'stop':
        this.playing = undefined;
        break;
      case 'wifi.forget':
        this.emit('forget-wifi'); // a real device restarts into setup
        break;
      // Older firmware logs these as unknown and does nothing, like this fake without networks.
      case 'wifi.setup':
        if (!this.wifi) break;
        this.updateWifi({ setup: true });
        setTimeout(() => this.updateWifi({ setup: false }), SETUP_MS).unref(); // as the device closes it
        this.emit('wifi-setup');
        break;
      case 'wifi.forget_network': {
        if (!this.wifi) break;
        const saved = this.wifi.saved.filter((s) => s !== message.ssid);
        // Forgetting the network in use: a real device leaves it and joins another saved one.
        const current = this.wifi.current === message.ssid ? (saved[0] ?? null) : this.wifi.current;
        this.updateWifi({ saved, current, rssi: current ? this.wifi.rssi : null });
        this.emit('forget-network', message.ssid);
        break;
      }
      case 'error':
        this.emit('bridge-error', message.message);
        break;
    }
  }

  private finishPlaying(id: string): void {
    const playing = this.playing;
    if (playing?.id !== id) return;
    this.playing = undefined;
    const played: Played = { id, kind: playing.kind, sampleRate: playing.sampleRate, pcm: Buffer.concat(playing.chunks) };
    const durationMs = (played.pcm.length / 2 / played.sampleRate) * 1000;
    const wait = this.realtime ? Math.max(0, durationMs - (Date.now() - playing.started)) : 0;
    setTimeout(() => {
      this.send({ type: 'played', id, stopped: false });
      this.emit('played', played);
    }, wait);
  }

  private send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: 'string', default: 'ws://127.0.0.1:8787/device' },
      id: { type: 'string', default: 'fake-desk-01' },
      dir: { type: 'string', default: '.fake' },
      play: { type: 'boolean', default: false },
      networks: { type: 'string', default: 'Home Wi-Fi,Phone hotspot' },
      'old-firmware': { type: 'boolean', default: false },
    },
  });
  const dir = path.resolve(values.dir);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out, { recursive: true });
  const keyFile = path.join(dir, `${values.id}.key`);
  const key = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : undefined;
  const say = (...parts: unknown[]) => console.log(`[${new Date().toLocaleTimeString()}]`, ...parts);

  const networks = values['old-firmware'] ? undefined : values.networks.split(',').map((n) => n.trim()).filter(Boolean);
  const device = new FakeDevice({ url: values.url, id: values.id, key, networks });
  device.realtime = true;
  device.on('pending', () => say(`waiting for approval: approve "${values.id}" in the admin page`));
  device.on('welcome', (newKey) => {
    fs.writeFileSync(keyFile, newKey);
    say('approved; key saved in', keyFile);
  });
  device.on('config', (c) => say('config:', JSON.stringify({ name: c.name, bot: c.bot, volume: c.volume, muted: c.muted })));
  device.on('show', (state) => say('shows', state));
  device.on('bridge-error', (message) => say('bridge says:', message));
  device.on('forget-wifi', () => say('asked to forget all its Wi-Fi networks (a real device restarts into setup)'));
  device.on('forget-network', (ssid) => say(`forgot the Wi-Fi network "${ssid}"; saved now: ${device.wifi?.saved.join(', ') || 'none'}`));
  device.on('wifi-setup', () => say('asked to open its Wi-Fi setup (a real device shows its setup QR code for 10 minutes)'));
  device.on('played', (p) => {
    const file = path.join(out, `${new Date().toISOString().replace(/[:.]/g, '-')}-${p.kind}.wav`);
    fs.writeFileSync(file, wav(p.pcm, p.sampleRate));
    say(`played ${p.kind}, ${(p.pcm.length / 2 / p.sampleRate).toFixed(1)} s →`, path.relative(process.cwd(), file));
    if (values.play) spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file], { stdio: 'ignore' }).on('error', () => say('(ffplay not found)'));
  });
  device.on('closed', (code, reason) => {
    say('connection closed', code, reason);
    process.exit(code === 1000 ? 0 : 1);
  });
  await device.connect();
  const commands = 'talk [file.wav] | stop | signal <dBm> | quit';
  say(`connected to ${values.url} as ${values.id}. Commands: ${commands}`);

  const input = readline.createInterface({ input: process.stdin });
  input.on('line', (line) => {
    const [command, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(' ');
    if (command === 'signal') {
      const rssi = Number(arg);
      if (!device.wifi?.current) say('no Wi-Fi network in use (or --old-firmware)');
      else if (!Number.isInteger(rssi) || rssi > 0 || rssi < -100) say('signal takes a level in dBm, like: signal -70');
      else device.updateWifi({ rssi });
    } else if (command === 'talk') {
      let pcm: Buffer;
      try {
        pcm = arg ? microphoneWav(arg) : tones([{ hz: 300, ms: 1500 }], MIC_RATE);
      } catch (err) {
        say(err instanceof Error ? err.message : err);
        return;
      }
      say(`talking (${(pcm.length / 2 / MIC_RATE).toFixed(1)} s)`);
      void device.talk(pcm, { realtime: true });
    } else if (command === 'stop') {
      device.stopSpeech();
    } else if (command === 'quit') {
      device.close();
    } else if (command) {
      say(`commands: ${commands}`);
    }
  });
}

/** A WAV file as the microphone would send it. */
function microphoneWav(file: string): Buffer {
  const info = readWav(fs.readFileSync(file));
  if (info.sampleRate !== MIC_RATE || info.channels !== 1 || info.bits !== 16) {
    throw new Error(`${file} must be 16 kHz mono 16-bit. Convert it with: ffmpeg -i in.wav -ac 1 -ar 16000 -sample_fmt s16 out.wav`);
  }
  return info.pcm;
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) await main();
