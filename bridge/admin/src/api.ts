// The bridge's admin API, as the page sees it.

export type Shape = 'blob' | 'teardrop' | 'cloud' | 'hex' | 'squircle' | 'circle';
export interface Avatar {
  shape: Shape;
  color: string;
}

export interface Timings {
  maxListenMs: number;
}

/** A device's Wi-Fi as it last reported it: network names only. */
export interface DeviceWifi {
  saved: string[]; // most recently joined first
  current: string | null;
  rssi: number | null; // dBm
  setup: boolean; // its setup network is open
  at: string;
}

/** Where a device's speech plays: on the device, on a Listen page in a browser, or both. */
export type SpeakOn = 'device' | 'page' | 'both';

export interface Device {
  id: string;
  name: string;
  status: 'pending' | 'approved';
  botId: string;
  volume: number;
  muted: boolean;
  speakOn: SpeakOn;
  timings: Timings;
  firmware: string;
  features: string[]; // what its firmware can do beyond 0.6.0 ("speaking": firmware 0.6.1), and its board's hardware (0.6.2)
  board: string; // the board it runs on ("waveshare-amoled-1.8"); "" from firmware before 0.6.2
  firstSeen: string;
  lastSeen: string;
  wifi: DeviceWifi | null; // null: its firmware doesn't report its networks
  online: boolean;
  waiting: boolean;
  showing: string | null; // what it shows; "listening" while the owner holds it
  speaking: SpeakOn | null; // where its speech plays right now
  listen: { open: number; ready: boolean }; // its Listen pages: how many are open, and whether one is ready
  attention: { since: string } | null; // its bot waits for the owner (spec §4.3.1)
}

export interface Bot {
  id: string;
  name: string;
  webhookUrl: string;
  webhookKey: string; // masked
  webhookKeySet: boolean;
  avatar: Avatar;
  voice: string;
  sendRecent: boolean;
}

export interface Service {
  provider: 'openai' | 'mock';
  baseUrl: string;
  apiKey: string; // masked
  apiKeySet: boolean;
  model: string;
}

export interface McpCall {
  at: string;
  /** Set when the call was refused for its key: what the key looked like, never the key. */
  refused?: string;
  userAgent: string;
  methods: string[];
  client: string;
  tool: string;
  argumentNames: string[];
  headerNames: string[];
  /** For a desk tool call: the bot it went to, and how it was found. */
  bot?: string;
  via?: Via;
}

/** How a call found its bot (spec §5.5). */
export type Via = 'request' | 'device' | 'bot' | 'only' | 'default';

/** One event in a turn record (spec §5.11): a call, the webhook, its speech, attention, or "no answer". */
export type TurnEvent =
  | {
      ms: number;
      call: 'desk_status' | 'desk_say';
      state?: string;
      chars?: number;
      spoken?: number;
      request_id: boolean;
      via?: Via;
      ok: boolean;
      answer: string;
      repeat?: number;
      history?: number;
    }
  | { ms: number; webhook: 'sent' | 'failed'; request_id: string; chars: number; answer?: string }
  | { ms: number; speech: 'started' | 'played' | 'stopped' | 'kept' | 'muted' | 'failed' | 'offline'; device: string; place?: string }
  | { ms: number; attention: 'started' | 'ended'; device: string }
  | { ms: number; no_answer: true };

export type CheckName = 'thinking_first' | 'ended' | 'request_id' | 'question_spoken' | 'no_repeats' | 'no_errors';
export type CheckResult = 'pass' | 'fail' | 'n/a' | 'pending';

/** What the bot called for one message, checked against its standing instructions (spec §5.11). */
export interface Turn {
  id: number;
  bot: string;
  kind: 'typed' | 'voice';
  request_id?: string;
  devices: string[];
  start: string;
  end: string;
  open: boolean;
  events: TurnEvent[];
  checks: Record<CheckName, CheckResult>;
  notes: string[];
  timings: Record<string, number>;
}

export interface HistoryEntry {
  id: number;
  at: string;
  kind: string;
  ok: boolean;
  deviceId?: string;
  botId?: string;
  text?: string;
  detail?: string;
  timings?: Record<string, number>;
}

export interface Overview {
  devices: Device[];
  bots: Bot[];
  defaultBotId: string; // where calls that name no bot go when there are several bots; '' refuses them
  speech: { tts: Service; stt: Service & { language: string; mockText: string } };
  mcp: { keySet: boolean; keyEnd: string; keyCreatedAt: string; url: string; calls: McpCall[] };
  history: HistoryEntry[];
  shapes: Shape[];
  displayStates: string[];
}

export async function api<T = { ok: boolean; message?: string }>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'x-desk-admin': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; ok?: boolean; message?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  if (json.ok === false) throw new Error(json.message ?? 'failed');
  return json;
}
