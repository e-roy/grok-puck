// Everything the bridge keeps: bots, devices, speech settings, the MCP key hash and a short history.
// One JSON file in the data directory; small enough to rewrite on every change.
import fs from 'node:fs';
import path from 'node:path';

export const AVATAR_SHAPES = ['blob', 'teardrop', 'cloud', 'hex', 'squircle', 'circle'] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number];

export interface Avatar {
  shape: AvatarShape;
  color: string; // #rrggbb
}

export interface Bot {
  id: string;
  name: string; // as in the Grok Bot app
  webhookUrl: string; // the routine's webhook
  webhookKey: string;
  avatar: Avatar;
  voice: string; // TTS voice id
  sendRecent: boolean; // include the last spoken exchanges with each voice message
}

export interface Timings {
  maxListenMs: number; // the longest message: listening ends here even if the finger is still down
}

export interface Device {
  id: string;
  name: string;
  status: 'pending' | 'approved';
  keyHash: string;
  botId: string;
  volume: number; // 0..100
  muted: boolean;
  timings: Timings;
  firmware: string;
  firstSeen: string;
  lastSeen: string;
}

export interface SpeechService {
  provider: 'openai' | 'mock'; // "openai" = any OpenAI-compatible service
  baseUrl: string; // ends in /v1
  apiKey: string;
  model: string;
}

export interface Speech {
  tts: SpeechService;
  stt: SpeechService & { language: string; mockText: string };
}

export type HistoryKind = 'voice' | 'say' | 'status' | 'device' | 'admin' | 'error';

export interface HistoryEntry {
  id: number;
  at: string;
  kind: HistoryKind;
  ok: boolean;
  deviceId?: string;
  botId?: string;
  text?: string;
  detail?: string;
  timings?: Record<string, number>; // milliseconds
}

export interface State {
  version: 1;
  mcpKeyHash: string;
  bots: Bot[];
  devices: Device[];
  speech: Speech;
  history: HistoryEntry[];
  nextHistoryId: number;
}

export const DEFAULT_TIMINGS: Timings = { maxListenMs: 60_000 };
const HISTORY_LIMIT = 300;

function defaultState(): State {
  return {
    version: 1,
    mcpKeyHash: '',
    bots: [],
    devices: [],
    speech: {
      tts: { provider: 'mock', baseUrl: '', apiKey: '', model: 'kokoro' },
      stt: { provider: 'mock', baseUrl: '', apiKey: '', model: '', language: 'en', mockText: 'Hello from the desk.' },
    },
    history: [],
    nextHistoryId: 1,
  };
}

export class Store {
  readonly state: State;
  private readonly file: string;
  private timer: NodeJS.Timeout | undefined;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'state.json');
    this.state = load(this.file);
  }

  /** Call after changing `state`; writes are batched. */
  changed(): void {
    this.timer ??= setTimeout(() => this.flush(), 200);
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const json = JSON.stringify(this.state, null, 2);
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, this.file);
    } catch {
      // A sync client (OneDrive, Dropbox) can hold the file for a moment; write it in place instead.
      fs.writeFileSync(this.file, json);
    }
  }

  bot(id: string): Bot | undefined {
    return id ? this.state.bots.find((b) => b.id === id) : undefined;
  }

  botByName(name: string): Bot | undefined {
    const wanted = name.trim().toLowerCase();
    return this.state.bots.find((b) => b.name.trim().toLowerCase() === wanted);
  }

  device(id: string): Device | undefined {
    return this.state.devices.find((d) => d.id === id);
  }

  addHistory(entry: Omit<HistoryEntry, 'id' | 'at'>): HistoryEntry {
    const full: HistoryEntry = { id: this.state.nextHistoryId++, at: new Date().toISOString(), ...entry };
    this.state.history.unshift(full);
    this.state.history.length = Math.min(this.state.history.length, HISTORY_LIMIT);
    this.changed();
    return full;
  }
}

function load(file: string): State {
  const fresh = defaultState();
  if (!fs.existsSync(file)) return fresh;
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<State>;
  return {
    ...fresh,
    ...saved,
    // Keep only the current timing fields (the countdown and silence settings left with hold-to-talk).
    devices: (saved.devices ?? []).map((d) => ({
      ...d,
      timings: { maxListenMs: d.timings?.maxListenMs ?? DEFAULT_TIMINGS.maxListenMs },
    })),
    speech: {
      tts: { ...fresh.speech.tts, ...saved.speech?.tts },
      stt: { ...fresh.speech.stt, ...saved.speech?.stt },
    },
  };
}
