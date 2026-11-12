// The bridge's admin API, as the page sees it.

export type Shape = 'blob' | 'teardrop' | 'cloud' | 'hex' | 'squircle' | 'circle';
export interface Avatar {
  shape: Shape;
  color: string;
}

export interface Timings {
  maxListenMs: number;
}

export interface Device {
  id: string;
  name: string;
  status: 'pending' | 'approved';
  botId: string;
  volume: number;
  muted: boolean;
  timings: Timings;
  firmware: string;
  firstSeen: string;
  lastSeen: string;
  online: boolean;
  waiting: boolean;
  showing: string | null;
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
  speech: { tts: Service; stt: Service & { language: string; mockText: string } };
  mcp: { keySet: boolean; url: string; calls: McpCall[] };
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
