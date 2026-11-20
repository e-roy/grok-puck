// Turn records (spec §5.11): what the bot called for each message, in order and with times, checked
// against its standing instructions. Voice turns are grouped by their request_id; typed turns, which
// the bridge never sees, by bot and by gaps in time. No text is kept, only lengths. They are kept in
// turns.json next to state.json: the turns of the last 30 days, never more than the latest 500.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TURN_LIMIT = 500;
export const TURN_DAYS = 30;
const DAY_MS = 86_400_000;
const QUIET_MS = 30_000; // a turn ends this long after a reply or a "waiting" with no call since
const EXPIRY_MS = 600_000; // or this long after its last call (the status it left showing expires)
const WRITE_DELAY_MS = 200;

/** How a call found its bot (spec §5.5): a voice turn's request_id, a device, the bot's name, the only bot, the default bot. */
export const VIAS = ['request', 'device', 'bot', 'only', 'default'] as const;
export type Via = (typeof VIAS)[number];

export const CHECK_NAMES = ['thinking_first', 'ended', 'request_id', 'question_spoken', 'no_repeats', 'no_errors'] as const;
export type CheckName = (typeof CHECK_NAMES)[number];
/** pending: it depends on what is still to come in a turn that is open. */
export type CheckResult = 'pass' | 'fail' | 'n/a' | 'pending';

export interface CallEvent {
  ms: number;
  call: 'desk_status' | 'desk_say';
  state?: string; // desk_status
  chars?: number; // desk_say: characters written
  spoken?: number; // desk_say: characters left to speak after the cleanup (spec §5.6)
  request_id: boolean; // it carried a request_id
  via?: Via; // absent when it found no bot
  ok: boolean;
  answer: string; // what the bridge answered
  repeat?: number; // the same call with the same arguments, this many times in a row (from 2)
  history?: number; // the History entry with its text (desk_say)
}

export interface WebhookEvent {
  ms: number;
  webhook: 'sent' | 'failed';
  request_id: string;
  chars: number; // the transcript's length
  answer?: string; // why it failed
}

export type SpeechResult = 'started' | 'played' | 'stopped' | 'kept' | 'muted' | 'failed' | 'offline';

export interface SpeechEvent {
  ms: number;
  speech: SpeechResult;
  device: string;
  place?: string; // with "started": device, page or both
}

export interface AttentionEvent {
  ms: number;
  attention: 'started' | 'ended';
  device: string;
}

export interface NoAnswerEvent {
  ms: number;
  no_answer: true; // the bridge gave up waiting for the reply (3 minutes) and showed "no answer"
}

export type TurnEvent = CallEvent | WebhookEvent | SpeechEvent | AttentionEvent | NoAnswerEvent;

interface StoredTurn {
  id: number;
  bot: string; // its name as set up, or as a call gave it for a bot the bridge doesn't know ('' for none)
  botId: string; // '' when no bot was found
  kind: 'typed' | 'voice';
  request_id?: string;
  devices: string[];
  start: string;
  events: TurnEvent[];
}

/** A turn as the admin page and the export show it. */
export interface TurnView {
  id: number;
  bot: string;
  kind: 'typed' | 'voice';
  request_id?: string;
  devices: string[];
  start: string;
  end: string; // its last event
  open: boolean;
  events: TurnEvent[];
  checks: Record<CheckName, CheckResult>;
  notes: string[];
  timings: Record<string, number>;
}

/** A turn, handed back to whoever reports what happened next in it (speech, attention). */
export type TurnRef = Readonly<{ id: number }>;

export interface CallInput {
  tool: 'desk_status' | 'desk_say';
  botId: string;
  bot: string;
  via?: Via;
  requestId?: string;
  devices: string[];
  state?: string;
  text?: string; // compared with the call before for repeats, never kept
  spoken?: number;
}

export interface TurnTiming {
  turnQuietMs: number;
  turnExpiryMs: number;
}

interface Stat {
  n: number;
  median: number;
  min: number;
  max: number;
}

export class TurnLog {
  private turns: StoredTurn[] = []; // oldest first
  private nextId = 1;
  private readonly file: string;
  private readonly quietMs: number;
  private readonly expiryMs: number;
  private readonly now: () => number;
  private readonly latest = new Map<string, StoredTurn>(); // each bot's latest turn
  private readonly voices = new Map<string, StoredTurn>(); // request_id → its voice turn
  private readonly lastArgs = new Map<number, { key: string; count: number }>(); // per turn, never stored
  private timer: NodeJS.Timeout | undefined;

  constructor(dataDir: string, timing: Partial<TurnTiming> = {}, now: () => number = Date.now) {
    this.file = path.join(dataDir, 'turns.json');
    this.quietMs = timing.turnQuietMs ?? QUIET_MS;
    this.expiryMs = timing.turnExpiryMs ?? EXPIRY_MS;
    this.now = now;
    this.load();
  }

  /** The bridge is posting a voice message to a bot's routine webhook: a voice turn opens. */
  voice(input: { botId: string; bot: string; requestId: string; devices: string[]; chars: number }): TurnRef {
    const turn = this.open(input.botId, input.bot, 'voice', input.devices);
    turn.request_id = input.requestId;
    turn.events.push({ ms: 0, webhook: 'sent', request_id: input.requestId, chars: input.chars });
    this.voices.set(input.requestId, turn);
    this.changed();
    return turn;
  }

  /** The webhook was refused or couldn't be reached: the bot never got the message. */
  webhookFailed(ref: TurnRef, answer: string): void {
    const event = this.find(ref)?.events.find((e): e is WebhookEvent => 'webhook' in e);
    if (!event) return;
    event.webhook = 'failed';
    event.answer = answer;
    this.changed();
  }

  /**
   * A desk_status or desk_say call from the bot. Returns its turn, its event (for the bridge's answer),
   * and whether it started a new turn: the owner's next message is being answered (spec §4.3.1).
   */
  call(input: CallInput): { turn: TurnRef; event: CallEvent; started: boolean } {
    const now = this.now();
    let turn = input.requestId ? this.voices.get(input.requestId) : undefined;
    let started = false;
    if (!turn) {
      const latest = this.latest.get(key(input.botId, input.bot));
      const answered =
        input.tool === 'desk_status' && input.state === 'thinking' && latest !== undefined && (replied(latest) || waited(latest));
      if (latest && this.isOpen(latest, now) && !answered) turn = latest;
      else {
        turn = this.open(input.botId, input.bot, 'typed', [], now);
        started = true;
      }
    }
    for (const name of input.devices) if (!turn.devices.includes(name)) turn.devices.push(name);
    const event: CallEvent = {
      ms: now - Date.parse(turn.start),
      call: input.tool,
      ...(input.tool === 'desk_status' ? { state: input.state } : { chars: input.text?.length ?? 0, spoken: input.spoken ?? 0 }),
      request_id: Boolean(input.requestId),
      ...(input.via ? { via: input.via } : {}),
      ok: true,
      answer: '',
    };
    // Repeats: the same tool with the same state or the same text, compared by a hash that isn't kept.
    const args = `${input.tool}:${input.tool === 'desk_status' ? input.state : digest(input.text ?? '')}`;
    const last = this.lastArgs.get(turn.id);
    const count = last?.key === args ? last.count + 1 : 1;
    this.lastArgs.set(turn.id, { key: args, count });
    if (count > 1) event.repeat = count;
    turn.events.push(event);
    this.changed();
    return { turn, event, started };
  }

  /** Something happened to a turn's speech: where it started, or how it ended. */
  speech(ref: TurnRef, device: string, speech: SpeechResult, place?: string): void {
    this.add(ref, { ms: 0, speech, device, ...(place ? { place } : {}) });
  }

  attention(ref: TurnRef, device: string, attention: 'started' | 'ended'): void {
    this.add(ref, { ms: 0, attention, device });
  }

  /** No reply within the bridge's 3 minutes: the device showed "no answer". */
  noAnswer(ref: TurnRef): void {
    this.add(ref, { ms: 0, no_answer: true });
  }

  /** Call after an event's fields changed (the bridge's answer to a call). */
  changed(): void {
    this.timer ??= setTimeout(() => this.flush(), WRITE_DELAY_MS).unref(); // the bridge's close() flushes what is left
  }

  /** The latest turns, newest first; only one bot's when `bot` is given (its name). */
  list(options: { bot?: string; limit?: number } = {}): { turns: TurnView[]; total: number } {
    const now = this.now();
    const wanted = options.bot?.trim().toLowerCase();
    const all = this.turns.filter((t) => !wanted || t.bot.toLowerCase() === wanted);
    const shown = all.slice(-(options.limit ?? TURN_LIMIT)).reverse();
    return { turns: shown.map((t) => this.view(t, now)), total: all.length };
  }

  /** Every kept turn (or one bot's), newest first, with a summary: for test notes. Holds no text. */
  export(bot?: string): { exported: string; bot: string | null; summary: ReturnType<typeof summarize>; turns: TurnView[] } {
    const { turns } = this.list({ bot });
    return { exported: new Date(this.now()).toISOString(), bot: bot?.trim() || null, summary: summarize(turns), turns };
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.prune();
    const json = JSON.stringify({ version: 1, nextId: this.nextId, turns: this.turns });
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, this.file);
    } catch {
      // A sync client can hold the file for a moment (as for state.json): write it in place instead.
      // Records are a help, not the desk's job: a failed write never stops the bridge.
      try {
        fs.writeFileSync(this.file, json);
      } catch {
        // The next change tries again.
      }
    }
  }

  close(): void {
    if (this.timer) this.flush();
  }

  // ---- inside ----

  /** A new turn, starting at `at` (the time of the event that opens it, so that event is at 0). */
  private open(botId: string, bot: string, kind: 'typed' | 'voice', devices: string[], at = this.now()): StoredTurn {
    const turn: StoredTurn = { id: this.nextId++, bot, botId, kind, devices: [...devices], start: new Date(at).toISOString(), events: [] };
    this.turns.push(turn);
    this.latest.set(key(botId, bot), turn);
    this.prune();
    return turn;
  }

  private find(ref: TurnRef): StoredTurn | undefined {
    const turn = ref as StoredTurn;
    return this.turns.includes(turn) ? turn : undefined;
  }

  private add(ref: TurnRef, event: TurnEvent): void {
    const turn = this.find(ref);
    if (!turn) return; // dropped meanwhile (older than the limits)
    event.ms = this.now() - Date.parse(turn.start);
    turn.events.push(event);
    this.changed();
  }

  /** A turn is open until 30 s after a reply or a "waiting" with nothing since, at "idle", or 10 minutes after its last call. */
  private isOpen(turn: StoredTurn, now: number): boolean {
    return now < this.deadline(turn);
  }

  private deadline(turn: StoredTurn): number {
    const start = Date.parse(turn.start);
    const last = [...turn.events].reverse().find((e): e is CallEvent | WebhookEvent => 'call' in e || 'webhook' in e);
    if (!last) return start + this.expiryMs;
    const at = start + last.ms;
    if ('webhook' in last) return last.webhook === 'failed' ? at : at + this.expiryMs;
    if (last.state === 'idle') return at;
    if (last.call === 'desk_say' || last.state === 'waiting') return at + this.quietMs;
    return at + this.expiryMs;
  }

  private view(turn: StoredTurn, now: number): TurnView {
    const open = this.isOpen(turn, now);
    const lastMs = turn.events.reduce((max, e) => Math.max(max, e.ms), 0);
    return {
      id: turn.id,
      bot: turn.bot,
      kind: turn.kind,
      ...(turn.request_id ? { request_id: turn.request_id } : {}),
      devices: turn.devices,
      start: turn.start,
      end: new Date(Date.parse(turn.start) + lastMs).toISOString(),
      open,
      events: turn.events,
      ...judge(turn, open),
    };
  }

  /** Drops the turns older than 30 days, and all but the latest 500. */
  private prune(): void {
    const oldest = this.now() - TURN_DAYS * DAY_MS;
    let keep = this.turns.filter((t) => Date.parse(t.start) >= oldest);
    if (keep.length > TURN_LIMIT) keep = keep.slice(-TURN_LIMIT);
    if (keep.length === this.turns.length) return;
    const kept = new Set(keep);
    for (const [k, t] of this.latest) if (!kept.has(t)) this.latest.delete(k);
    for (const [k, t] of this.voices) if (!kept.has(t)) this.voices.delete(k);
    for (const t of this.turns) if (!kept.has(t)) this.lastArgs.delete(t.id);
    this.turns = keep;
  }

  private load(): void {
    if (!fs.existsSync(this.file)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { nextId?: unknown; turns?: unknown };
      if (!Array.isArray(saved.turns)) throw new Error('no turns');
      this.turns = saved.turns.filter(isStoredTurn);
      const highest = this.turns.reduce((max, t) => Math.max(max, t.id), 0);
      this.nextId = Math.max(typeof saved.nextId === 'number' ? saved.nextId : 1, highest + 1);
    } catch {
      // Unreadable: set aside for a look, and start afresh rather than stop the bridge.
      try {
        fs.renameSync(this.file, `${this.file}.unreadable`);
      } catch {
        // It will be written over with the next turn.
      }
      this.turns = [];
      return;
    }
    this.prune();
    for (const turn of this.turns) {
      this.latest.set(key(turn.botId, turn.bot), turn);
      if (turn.request_id) this.voices.set(turn.request_id, turn);
    }
  }
}

function key(botId: string, bot: string): string {
  return botId ? `id:${botId}` : `name:${bot.trim().toLowerCase()}`;
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('base64url').slice(0, 16);
}

function calls(turn: StoredTurn): CallEvent[] {
  return turn.events.filter((e): e is CallEvent => 'call' in e);
}

function replied(turn: StoredTurn): boolean {
  return calls(turn).some((c) => c.call === 'desk_say' || c.state === 'idle');
}

function waited(turn: StoredTurn): boolean {
  return calls(turn).some((c) => c.state === 'waiting');
}

function isStoredTurn(value: unknown): value is StoredTurn {
  const t = value as StoredTurn;
  return (
    typeof t === 'object' &&
    t !== null &&
    typeof t.id === 'number' &&
    typeof t.bot === 'string' &&
    typeof t.botId === 'string' &&
    (t.kind === 'typed' || t.kind === 'voice') &&
    Array.isArray(t.devices) &&
    typeof t.start === 'string' &&
    !Number.isNaN(Date.parse(t.start)) &&
    Array.isArray(t.events)
  );
}

/** The checks against the standing instructions, the notes and the timings of one turn. */
function judge(turn: StoredTurn, open: boolean): Pick<TurnView, 'checks' | 'notes' | 'timings'> {
  const list = calls(turn);
  const notes: string[] = [];
  const webhook = turn.events.find((e): e is WebhookEvent => 'webhook' in e);
  if (webhook?.webhook === 'failed') {
    notes.push(`The webhook failed, so the bot never got the message: ${webhook.answer ?? 'no reason given'}.`);
    if (!list.length) {
      const none = Object.fromEntries(CHECK_NAMES.map((c) => [c, 'n/a'])) as Record<CheckName, CheckResult>;
      return { checks: none, notes, timings: {} };
    }
  }
  const later = (result: 'pass' | 'fail'): CheckResult => (result === 'fail' && open ? 'pending' : result);
  const say = list.find((c) => c.call === 'desk_say');
  const waiting = list.find((c) => c.state === 'waiting');
  const first = list[0];
  const checks: Record<CheckName, CheckResult> = {
    thinking_first: first ? (first.call === 'desk_status' && first.state === 'thinking' ? 'pass' : 'fail') : later('fail'),
    ended: later(replied(turn) ? 'pass' : 'fail'),
    request_id: turn.kind !== 'voice' || !list.length ? 'n/a' : list.every((c) => c.request_id) ? 'pass' : 'fail',
    question_spoken: !waiting ? 'n/a' : later(say ? 'pass' : 'fail'),
    no_repeats: list.some((c) => (c.repeat ?? 0) > 2) ? 'fail' : 'pass',
    no_errors: list.some((c) => !c.ok) ? 'fail' : 'pass',
  };
  if (list.length && !list.some((c) => c.state === 'working')) notes.push('No "working": right only if it used no tools.');
  if (list.some((c) => c.via === 'default')) {
    notes.push('Found its bot only as the default bot: another bot that forgot its name would look the same.');
  }
  if (waiting && say && list.indexOf(say) < list.indexOf(waiting)) notes.push('It asked before calling "waiting".');
  const gaveUp = turn.events.find((e) => 'no_answer' in e);
  if (gaveUp && say && say.ms > gaveUp.ms) notes.push('It replied after the 3 minutes: the device showed "no answer", then spoke the reply.');

  const timings: Record<string, number> = {};
  if (turn.kind === 'voice') {
    if (first) timings.first_call_ms = first.ms;
    if (say) timings.reply_ms = say.ms;
  } else if (say && first) {
    timings.reply_ms = say.ms - first.ms;
  }
  const started = turn.events.find((e): e is SpeechEvent => 'speech' in e && e.speech === 'started');
  if (started && say) timings.speech_wait_ms = Math.max(0, started.ms - say.ms);
  if (started) {
    const ended = turn.events.find(
      (e): e is SpeechEvent => 'speech' in e && e.device === started.device && e.ms >= started.ms && (e.speech === 'played' || e.speech === 'stopped'),
    );
    if (ended) timings.speech_ms = ended.ms - started.ms;
  }
  timings.total_ms = turn.events.reduce((max, e) => Math.max(max, e.ms), 0);
  return { checks, notes, timings };
}

/** How many turns passed and failed each check, and the spread of each timing: counts and times only. */
function summarize(turns: TurnView[]) {
  const checks = Object.fromEntries(
    CHECK_NAMES.map((name) => {
      const counts = { pass: 0, fail: 0, 'n/a': 0, pending: 0 };
      for (const t of turns) counts[t.checks[name]]++;
      return [name, counts];
    }),
  ) as Record<CheckName, Record<CheckResult, number>>;
  const closed = turns.filter((t) => !t.open);
  const notes: Record<string, number> = {};
  for (const t of turns) for (const n of t.notes) notes[n] = (notes[n] ?? 0) + 1;
  const timing = (kind: 'typed' | 'voice' | null, name: string) =>
    stat(turns.filter((t) => kind === null || t.kind === kind).map((t) => t.timings[name]).filter((v): v is number => v !== undefined));
  return {
    turns: turns.length,
    typed: turns.filter((t) => t.kind === 'typed').length,
    voice: turns.filter((t) => t.kind === 'voice').length,
    open: turns.length - closed.length,
    all_checks_passed: closed.filter((t) => !Object.values(t.checks).includes('fail')).length,
    checks,
    notes,
    timings: {
      typed_reply_ms: timing('typed', 'reply_ms'),
      voice_first_call_ms: timing('voice', 'first_call_ms'),
      voice_reply_ms: timing('voice', 'reply_ms'),
      speech_wait_ms: timing(null, 'speech_wait_ms'),
      speech_ms: timing(null, 'speech_ms'),
    },
  };
}

function stat(values: number[]): Stat | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return { n: sorted.length, median, min: sorted[0], max: sorted[sorted.length - 1] };
}
