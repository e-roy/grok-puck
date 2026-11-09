// Speech services. "openai" means any service with OpenAI's audio API: a self-hosted Kokoro/Speaches
// server, OpenAI itself, Groq and others. "mock" needs no service and is for tests.
import { babble, SPEAKER_RATE } from './audio.ts';
import type { Speech, SpeechService } from './store.ts';

export interface Tts {
  /** 16-bit mono PCM at SPEAKER_RATE, as it is produced. */
  synthesize(text: string, voice: string): AsyncIterable<Buffer>;
  voices(): Promise<string[]>;
}

export interface Stt {
  transcribe(wavFile: Buffer): Promise<string>;
}

// OpenAI has no voice list endpoint; these are its documented voices.
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];
const TTS_TIMEOUT_MS = 180_000;
const STT_TIMEOUT_MS = 60_000;

export function makeTts(service: SpeechService): Tts {
  if (service.provider === 'mock') return mockTts;
  return {
    async *synthesize(text, voice) {
      const res = await fetch(`${baseUrl(service)}/audio/speech`, {
        method: 'POST',
        headers: headers(service, true),
        body: JSON.stringify({ model: service.model || 'tts-1', voice, input: text, response_format: 'pcm' }),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      });
      if (!res.ok || !res.body) throw new Error(`TTS answered ${await problem(res)}`);
      for await (const chunk of res.body) yield Buffer.from(chunk);
    },
    async voices() {
      const res = await fetch(`${baseUrl(service)}/audio/voices`, {
        headers: headers(service, false),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404) {
        // No voice list: Speaches lists each model's voices with the model; OpenAI has neither.
        const entry = (await fetchModels(service).catch(() => null))?.find((m) => m.id === service.model);
        return entry?.voices?.length ? entry.voices : OPENAI_VOICES;
      }
      if (!res.ok) throw new Error(`voice list answered ${await problem(res)}`);
      return parseVoices(await res.json());
    },
  };
}

export function makeStt(service: Speech['stt']): Stt {
  if (service.provider === 'mock') {
    return { transcribe: async () => service.mockText };
  }
  return {
    async transcribe(wavFile) {
      if (!service.model) throw new Error('no STT model is set (admin page → Speech)');
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(wavFile)], { type: 'audio/wav' }), 'speech.wav');
      form.append('model', service.model);
      if (service.language) form.append('language', service.language);
      form.append('response_format', 'json');
      const res = await fetch(`${baseUrl(service)}/audio/transcriptions`, {
        method: 'POST',
        headers: headers(service, false),
        body: form,
        signal: AbortSignal.timeout(STT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`STT answered ${await problem(res)}`);
      const body = (await res.json()) as { text?: unknown };
      return typeof body.text === 'string' ? body.text : '';
    },
  };
}

// Words that mark a model as being for this job; those are listed first.
const MODEL_HINTS = { tts: /tts|kokoro|speech|voice/i, stt: /whisper|transcri|stt|asr|parakeet/i };
// The `task` some servers (Speaches) give each model.
const MODEL_TASKS = { tts: /text-to-speech|^tts$/i, stt: /speech-recognition|transcri|^stt$|^asr$/i };

interface ModelEntry {
  id: string;
  task?: string;
  voices?: string[];
}

/**
 * The models a service offers for `which` (OpenAI's `GET /models`), the likely ones first, and the
 * base URL that answered: when the typed one has no list but the same address with /v1 does, that one.
 * Null when the service has no model list.
 */
export async function listModels(
  service: SpeechService,
  which: 'tts' | 'stt',
): Promise<{ models: string[]; baseUrl: string } | null> {
  if (service.provider === 'mock') return { models: ['mock'], baseUrl: service.baseUrl };
  const typed = baseUrl(service);
  const tries = /\/v1$/.test(typed) ? [typed] : [typed, `${typed}/v1`];
  for (const base of tries) {
    const entries = await fetchModels({ ...service, baseUrl: base });
    if (entries) return { models: pickModels(entries, which), baseUrl: base };
  }
  return null;
}

// Names many OpenAI-style TTS servers accept even when they list their models under other names.
const COMMON_TTS_MODELS = ['kokoro', 'tts-1'];
const CHECK_TIMEOUT_MS = 20_000;

/**
 * Which TTS models really speak: a server's list and what its speech endpoint accepts can differ. The
 * likely ones from `listed` and the common names each get a one-word request, in parallel. Those that
 * speak come first, ones refused are dropped, and untried ones are kept after them.
 */
export async function checkTtsModels(service: SpeechService, listed: string[]): Promise<{ models: string[]; message?: string }> {
  const likely = listed.filter((m) => MODEL_HINTS.tts.test(m)).slice(0, 4);
  const tried = [...new Set([...likely, ...COMMON_TTS_MODELS])];
  // A voice the server has (without its own voice list, the listed model's voices are asked for).
  const voice = (await makeTts({ ...service, model: likely[0] ?? service.model }).voices().catch(() => []))[0] ?? OPENAI_VOICES[0];
  const errors = new Map<string, string>();
  const speaks = await Promise.all(
    tried.map(async (model) => {
      const attempt = (async () => {
        for await (const chunk of makeTts({ ...service, model }).synthesize('Hi.', voice)) if (chunk.length) return true;
        return false;
      })();
      const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CHECK_TIMEOUT_MS).unref());
      return Promise.race([attempt, timeout]).catch((err: unknown) => {
        errors.set(model, err instanceof Error ? err.message : String(err));
        return false;
      });
    }),
  );
  const working = tried.filter((_, i) => speaks[i]);
  const refused = likely.filter((m) => !working.includes(m));
  const models = [...working, ...listed.filter((m) => !tried.includes(m))];
  if (working.length === 0) {
    const reason = errors.get(likely[0] ?? tried[0]) ?? 'no audio came back';
    return { models: listed, message: `None of the likely models spoke in a quick test (${reason}).` };
  }
  const message = `Spoke in a quick test: ${working.join(', ')}.${refused.length ? ` Listed but refused for speech: ${refused.join(', ')}.` : ''}`;
  return { models, message };
}

async function fetchModels(service: SpeechService): Promise<ModelEntry[] | null> {
  const res = await fetch(`${baseUrl(service)}/models`, { headers: headers(service, false), signal: AbortSignal.timeout(10_000) });
  if (res.status === 404 || res.status === 405) return null;
  if (!res.ok) throw new Error(`the model list answered ${await problem(res)}`);
  // A web page (a login screen, a site's own 200 page) is not a model list.
  if (!/json/i.test(res.headers.get('content-type') ?? '')) return null;
  return parseModels(await res.json());
}

function pickModels(entries: ModelEntry[], which: 'tts' | 'stt'): string[] {
  const task = MODEL_TASKS[which];
  // When the server says what each model is for, leave out the ones for other jobs.
  const fitting = entries.some((m) => m.task) ? entries.filter((m) => !m.task || task.test(m.task)) : entries;
  const hint = MODEL_HINTS[which];
  return fitting.map((m) => m.id).sort((a, b) => Number(!hint.test(a)) - Number(!hint.test(b)) || a.localeCompare(b));
}

function parseModels(body: unknown): ModelEntry[] {
  const b = body as { data?: unknown; models?: unknown } | null;
  const list: unknown[] = Array.isArray(body) ? body : Array.isArray(b?.data) ? b.data : Array.isArray(b?.models) ? b.models : [];
  const seen = new Map<string, ModelEntry>();
  for (const m of list) {
    const o = (typeof m === 'object' && m) || {};
    const id = typeof m === 'string' ? m : ((o as { id?: unknown }).id ?? (o as { name?: unknown }).name);
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    const task = (o as { task?: unknown }).task;
    const voices = (o as { voices?: unknown }).voices;
    seen.set(id, {
      id,
      task: typeof task === 'string' ? task : undefined,
      voices: Array.isArray(voices) ? parseVoices(voices) : undefined,
    });
  }
  return [...seen.values()];
}

const mockTts: Tts = {
  async *synthesize(text) {
    // Arrives in a few pieces, like a real streamed answer.
    const pcm = babble(text, SPEAKER_RATE);
    const piece = Math.ceil(pcm.length / 8) & ~1;
    for (let at = 0; at < pcm.length; at += piece) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield pcm.subarray(at, at + piece);
    }
  },
  voices: async () => ['mock'],
};

function baseUrl(service: SpeechService): string {
  if (!service.baseUrl) throw new Error('no base URL is set for this speech service (admin page → Speech)');
  return service.baseUrl.replace(/\/+$/, '');
}

function headers(service: SpeechService, json: boolean): Record<string, string> {
  const result: Record<string, string> = {};
  if (service.apiKey) result.authorization = `Bearer ${service.apiKey}`;
  if (json) result['content-type'] = 'application/json';
  return result;
}

function parseVoices(body: unknown): string[] {
  const list = Array.isArray(body) ? body : (body as { voices?: unknown })?.voices;
  if (!Array.isArray(list)) return [];
  return list
    .map((v) => (typeof v === 'string' ? v : ((v as { id?: unknown; name?: unknown })?.id ?? (v as { name?: unknown })?.name)))
    .filter((v): v is string => typeof v === 'string')
    .sort();
}

/** What went wrong, readably: the status and a short reason (an HTML error page gives its title). */
export async function problem(res: Response): Promise<string> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    // no body
  }
  if (res.status === 530 || /cloudflare tunnel error/i.test(body)) {
    return `${res.status}: Cloudflare can't reach the server behind its tunnel. Check that the server and its cloudflared are running.`;
  }
  const title = body.match(/<title>([^<]*)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
  if (title) return `${res.status} (${title.slice(0, 120)})`;
  const text = body.replace(/\s+/g, ' ').trim().slice(0, 200);
  return text ? `${res.status}: ${text}` : String(res.status);
}
