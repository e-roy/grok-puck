// What the desk does: hands what the owner says to their bot, and speaks and shows what the bot
// sends back. The hub moves the bytes; this decides what goes where, and records what the bot called
// in its turns (spec §5.11).
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { attentionChirp, ERROR_TONE, MIC_RATE, NO_ANSWER_TONE, SPEAKER_RATE, type Tone, tones, wav } from './audio.ts';
import { Clip } from './clip.ts';
import { errorText } from './errors.ts';
import { postWebhook, type VoiceMessage } from './grokbot.ts';
import type { DeviceHub, Place } from './hub.ts';
import { RateLimit } from './ratelimit.ts';
import { speakable } from './speakable.ts';
import { makeStt, makeTts } from './speech.ts';
import type { Bot, Device, Store } from './store.ts';
import type { CallEvent, TurnLog, TurnRef, Via } from './turns.ts';

const REPLY_TIMEOUT_MS = 180_000; // then the device shows "no answer"
const LATE_REPLY_MS = 3_600_000; // a reply this late still finds its device
const STATUS_EXPIRY_MS = 600_000; // a "thinking" or "working" the bot never ended; "waiting" stays
const OFFLINE_QUEUE = 5;
const RECENT_LIMIT = 6;
const REPEAT_MS = 60_000; // the same text twice within this is spoken once

export const BOT_STATES = ['thinking', 'working', 'waiting', 'idle'] as const;
export type BotState = (typeof BOT_STATES)[number];

/** Where a tool call goes: the device that asked, a named device, or every device of a bot. */
export interface Target {
  requestId?: string;
  device?: string;
  bot?: string;
}

export interface Outcome {
  ok: boolean;
  message: string;
  /** For Recent calls: the bot a tool call went to, and how it was found (spec §5.5). */
  bot?: string;
  via?: Via;
}

export interface DeskTiming {
  statusExpiryMs: number;
}

interface VoiceRequest {
  id: string;
  deviceId: string; // '' for a test message sent from the admin page with no device
  botId: string;
  at: number;
  answered: boolean;
  timedOut: boolean;
  timeout: NodeJS.Timeout;
  expiry: NodeJS.Timeout;
  turn: TurnRef;
}

interface Targets {
  devices: Device[];
  bot: Bot | undefined;
  request: VoiceRequest | undefined;
  via: Via;
}

/** Why a call reaches no device, with the bot it was for when that is known. */
interface Refusal {
  error: string;
  bot?: Bot;
  via?: Via;
}

/** A call from the bot (through MCP), as opposed to the admin page's tests: only these are recorded. */
interface CallOptions {
  fromBot?: boolean;
}

export class Desk {
  private readonly store: Store;
  private readonly hub: DeviceHub;
  private readonly log: FastifyBaseLogger;
  private readonly turns: TurnLog;
  private readonly statusExpiryMs: number;
  private readonly requests = new Map<string, VoiceRequest>();
  private readonly offline = new Map<string, Array<{ text: string; botId: string }>>();
  private readonly recent = new Map<string, Array<{ who: 'owner' | 'bot'; text: string }>>();
  private readonly lastSpoken = new Map<string, { text: string; at: number }>();
  private readonly botStates = new Map<string, BotState>(); // what the bot last reported, per device
  private readonly statusTimers = new Map<string, NodeJS.Timeout>();
  private readonly limits = { voice: new RateLimit(60), say: new RateLimit(120), status: new RateLimit(600) };

  constructor(store: Store, hub: DeviceHub, log: FastifyBaseLogger, turns: TurnLog, timing: Partial<DeskTiming> = {}) {
    this.store = store;
    this.hub = hub;
    this.log = log;
    this.turns = turns;
    this.statusExpiryMs = timing.statusExpiryMs ?? STATUS_EXPIRY_MS;
    // Attention outlasts a restart of the bridge (spec §4.3.1).
    for (const device of store.state.devices) if (device.attention) this.botStates.set(device.id, 'waiting');
  }

  /** A device heard the owner: transcribe it and hand it to the device's bot. */
  async onUtterance(device: Device, pcm: Buffer): Promise<void> {
    const started = performance.now();
    const bot = this.store.bot(device.botId);
    if (!bot) {
      this.fail(device, undefined, 'this device is not attached to a bot');
      return;
    }
    this.hub.show(device.id, 'thinking');
    let text: string;
    try {
      text = (await makeStt(this.store.state.speech.stt).transcribe(wav(pcm, MIC_RATE))).trim();
    } catch (err) {
      this.fail(device, bot, `speech-to-text failed: ${errorText(err)}`);
      return;
    }
    const timings = { audio: Math.round(pcm.length / 32), stt: Math.round(performance.now() - started) };
    if (!text) {
      this.store.addHistory({ kind: 'voice', ok: false, deviceId: device.id, botId: bot.id, detail: 'nothing was recognised', timings });
      this.showResting(device.id);
      return;
    }
    await this.sendToBot(device, bot, text, timings);
  }

  /** Starts a routine run with `text` as if the owner had said it. Also the admin page's test. */
  async sendToBot(device: Device | undefined, bot: Bot, text: string, timings: Record<string, number> = {}): Promise<Outcome> {
    // The owner is back and talking to the bot: attention ends on every device of that bot (spec §4.3.1).
    const back = this.devicesOf(bot).filter((d) => d.attention);
    for (const d of back) this.setBotState(d.id, 'idle');
    for (const d of back) if (d.id !== device?.id) this.showResting(d.id);
    if (!bot.webhookUrl) {
      return this.fail(device, bot, `${bot.name} has no webhook URL yet (it is the Grok Bot routine's webhook, set under Bots)`, text);
    }
    if (!this.limits.voice.take()) return this.fail(device, bot, 'too many voice messages this hour');
    if (device && this.hub.shown(device.id) !== 'thinking') this.hub.show(device.id, 'thinking');
    const request = this.open(device, bot, text);
    for (const d of back) this.turns.attention(request.turn, d.name, 'ended');
    const message: VoiceMessage = {
      request_id: request.id,
      text,
      device_id: device?.id ?? '',
      device_name: device?.name ?? '',
      bot_name: bot.name,
      reply_with: 'desk_say, passing this request_id',
      ...(bot.sendRecent && device ? { recent: [...(this.recent.get(device.id) ?? [])] } : {}),
    };
    try {
      const res = await postWebhook(bot, message);
      timings.webhook = res.ms;
      if (res.status < 200 || res.status > 299) throw new Error(`it answered HTTP ${res.status}`);
    } catch (err) {
      this.close(request);
      this.turns.webhookFailed(request.turn, errorText(err));
      return this.fail(device, bot, `the bot's webhook failed: ${errorText(err)}`, text);
    }
    if (device) this.remember(device.id, 'owner', text);
    this.store.addHistory({ kind: 'voice', ok: true, deviceId: device?.id, botId: bot.id, text, timings, detail: `request ${request.id}` });
    return { ok: true, message: `Sent to ${bot.name}. Its reply will be spoken when it calls desk_say.` };
  }

  /**
   * The bot's words, spoken on the devices it targets. The same text twice within a minute is spoken
   * once, unless `allowRepeat` (the admin page's "Speak it") or it answers a new voice message.
   */
  say(text: string, target: Target, { allowRepeat = false, fromBot = false }: { allowRepeat?: boolean } & CallOptions = {}): Outcome {
    const spoken = speakable(text);
    const record = (found: Targets | Refusal) =>
      fromBot ? this.record('desk_say', target, found, { text, spoken: spoken.length }) : undefined;
    if (!this.limits.say.take()) return this.refuse(record, target, 'Too many desk_say calls this hour; try again later.');
    const found = this.resolve(target);
    if ('error' in found) return this.refuse(record, target, found.error, found);
    const { devices, bot, request, via } = found;
    const call = record(found);
    const timings: Record<string, number> = {};
    // The first reply to a voice message is always spoken, even if an earlier answer had the same words.
    if (request && !request.answered) allowRepeat = true;
    if (request && !request.answered) {
      request.answered = true;
      clearTimeout(request.timeout);
      timings.reply = Date.now() - request.at;
    }
    for (const device of devices) {
      this.remember(device.id, 'bot', text);
      // A reply ends "thinking" and "working". "Waiting" stays, since the reply may be the question,
      // unless this reply starts the bot's next turn: then the owner has answered (spec §4.3.1).
      if (this.botStates.get(device.id) !== 'waiting' || call?.started) this.setBotState(device.id, 'idle', call?.turn);
      if (device.muted) this.showResting(device.id);
    }
    const done = (outcome: Outcome, history?: number): Outcome => {
      if (call) this.answer(call.event, outcome, history);
      return { ...outcome, bot: bot?.name, via };
    };
    if (!spoken) {
      for (const device of devices) this.showResting(device.id);
      const entry = this.store.addHistory({ kind: 'say', ok: true, botId: bot?.id, text, timings, detail: 'nothing to speak (only code or links)' });
      return done({ ok: true, message: 'Nothing was spoken: the text was only code or links.' }, entry.id);
    }
    // Without a voice nothing can be spoken: say so now rather than fail later, or keep it for later.
    const noVoice = this.voiceProblem(bot, devices);
    if (noVoice) {
      let outcome: Outcome = { ok: false, message: noVoice };
      for (const device of devices) outcome = this.fail(device, bot, noVoice, text);
      return done(outcome);
    }
    const now = Date.now();
    const repeats = devices.filter((d) => {
      const last = this.lastSpoken.get(d.id);
      return !allowRepeat && last !== undefined && last.text === spoken && now - last.at < REPEAT_MS;
    });
    const report = this.speak(
      devices.filter((d) => !repeats.includes(d)),
      bot,
      spoken,
      call?.turn,
    );
    const message = [report, repeats.length ? `Already spoken on ${names(repeats)} a moment ago.` : ''].filter(Boolean).join(' ');
    const entry = this.store.addHistory({
      kind: 'say',
      ok: true,
      botId: bot?.id,
      deviceId: devices.length === 1 ? devices[0].id : undefined,
      text,
      timings,
      detail: message,
    });
    return done({ ok: true, message }, entry.id);
  }

  /** What the bot is doing, shown on its devices. */
  status(state: BotState, target: Target, { fromBot = false }: CallOptions = {}): Outcome {
    const record = (found: Targets | Refusal) => (fromBot ? this.record('desk_status', target, found, { state }) : undefined);
    if (!this.limits.status.take()) return this.refuse(record, target, 'Too many desk_status calls this hour.');
    const found = this.resolve(target);
    if ('error' in found) return this.refuse(record, target, found.error, found);
    const call = record(found);
    for (const device of found.devices) {
      this.setBotState(device.id, state, call?.turn);
      this.showResting(device.id);
    }
    const outcome = { ok: true, message: `Showing "${state}" on ${names(found.devices)}.` };
    if (call) this.answer(call.event, outcome);
    return { ...outcome, bot: found.bot?.name, via: found.via };
  }

  devicesSummary(): Outcome {
    const devices = this.store.state.devices.filter((d) => d.status === 'approved');
    if (!devices.length) return { ok: true, message: 'No desk devices are set up yet.' };
    const lines = devices.map((d) => {
      const bot = this.store.bot(d.botId);
      const online = this.hub.isOnline(d.id) ? `online, showing ${this.hub.shown(d.id)}` : 'offline';
      return `- ${d.name} (id ${d.id}): ${online}; bot: ${bot?.name ?? 'none'}${d.muted ? '; muted' : ''}`;
    });
    return { ok: true, message: lines.join('\n') };
  }

  /** The admin page's Clear: this device stops showing that its bot waits for the owner. */
  clearAttention(deviceId: string): boolean {
    const device = this.store.device(deviceId);
    if (!device?.attention) return false;
    this.setBotState(deviceId, 'idle');
    this.showResting(deviceId);
    return true;
  }

  /** A device (re)connected: show the right state and speak what it missed. */
  onConnected(device: Device): void {
    this.showResting(device.id);
    this.speakMissed(device);
  }

  /** A Listen page now plays for this device: what it missed while it had nowhere to speak plays there. */
  onPageReady(device: Device): void {
    this.speakMissed(device);
  }

  /** Nothing is playing on the device any more. */
  onQuiet(device: Device): void {
    this.showResting(device.id);
  }

  close(request?: VoiceRequest): void {
    const all = request ? [request] : [...this.requests.values()];
    for (const r of all) {
      clearTimeout(r.timeout);
      clearTimeout(r.expiry);
      this.requests.delete(r.id);
    }
    if (!request) for (const timer of this.statusTimers.values()) clearTimeout(timer);
  }

  /**
   * Speaks on each device where its Speak on setting says (the device, its Listen page or both), and
   * keeps it for a device with nowhere to speak now. Says where, for the bot and the history.
   */
  private speak(devices: Device[], bot: Bot | undefined, spoken: string, turn?: TurnRef): string {
    const muted = devices.filter((d) => d.muted);
    const routed = devices.filter((d) => !d.muted).map((device) => ({ device, place: this.hub.route(device.id) }));
    const away = routed.filter((r) => r.place === null).map((r) => r.device);
    const playing = routed.filter((r): r is { device: Device; place: Place } => r.place !== null);
    for (const device of away) this.keep(device, spoken, bot);
    if (turn) {
      for (const device of muted) this.turns.speech(turn, device.name, 'muted');
      for (const device of away) this.turns.speech(turn, device.name, 'kept');
    }
    if (playing.length) {
      const clip = this.synthesize(spoken, bot);
      const at = Date.now();
      clip.settled.catch((err: unknown) => {
        for (const { device } of playing) {
          // Not spoken after all, so the same text may be tried again at once.
          if (this.lastSpoken.get(device.id)?.at === at) this.lastSpoken.delete(device.id);
          this.fail(device, bot, `text-to-speech failed: ${errorText(err)}`, spoken);
        }
      });
      for (const { device, place } of playing) {
        this.lastSpoken.set(device.id, { text: spoken, at });
        const started = turn ? (where: Place) => this.turns.speech(turn, device.name, 'started', where) : undefined;
        void this.hub.play(device.id, clip, 'speech', place, { started }).then((result) => {
          if (turn) this.turns.speech(turn, device.name, result === 'offline' ? 'kept' : result);
          // It went offline and its page closed while the clip waited: kept for later, as if it had been offline.
          if (result === 'offline') this.keep(device, spoken, bot);
        });
      }
    }
    const on = (place: Place) => playing.filter((r) => r.place === place).map((r) => r.device);
    const [here, page, both] = [on('device'), on('page'), on('both')];
    const later = away.some((d) => d.speakOn !== 'device') ? ' or a Listen page is ready' : '';
    return [
      here.length ? `Speaking on ${names(here)}.` : '',
      page.length ? `Speaking on the Listen page for ${names(page)}.` : '',
      both.length ? `Speaking on ${names(both)} and ${both.length > 1 ? 'their' : 'its'} Listen page.` : '',
      away.length ? `Saved for ${names(away)} (offline); spoken when ${away.length > 1 ? 'they reconnect' : 'it reconnects'}${later}.` : '',
      muted.length ? `${names(muted)} ${muted.length > 1 ? 'are' : 'is'} muted.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  /** Keeps speech for a device that can't speak now (offline, and no Listen page plays for it). */
  private keep(device: Device, spoken: string, bot: Bot | undefined): void {
    const queue = this.offline.get(device.id) ?? [];
    queue.push({ text: spoken, botId: bot?.id ?? device.botId });
    this.offline.set(device.id, queue.slice(-OFFLINE_QUEUE));
  }

  private speakMissed(device: Device): void {
    const missed = this.offline.get(device.id) ?? [];
    if (!missed.length || !this.hub.route(device.id)) return;
    this.offline.delete(device.id);
    for (const item of missed) this.speak([device], this.store.bot(item.botId), item.text);
  }

  /** Why these devices can't speak for this bot, if they can't. */
  private voiceProblem(bot: Bot | undefined, devices: Device[]): string | undefined {
    if (this.store.state.speech.tts.provider === 'mock' || bot?.voice) return undefined;
    if (!bot) return `${names(devices)} has no bot yet: add one under Bots (with a voice), then choose it for the device`;
    return `no voice is chosen for ${bot.name} (admin page → Bots)`;
  }

  private synthesize(spoken: string, bot: Bot | undefined): Clip {
    const tts = this.store.state.speech.tts;
    const voice = bot?.voice ?? '';
    if (tts.provider !== 'mock' && !voice) {
      return Clip.failed(new Error(`no voice is chosen for ${bot?.name ?? 'this bot'} (admin page → Bots)`), SPEAKER_RATE);
    }
    return Clip.from(makeTts(tts).synthesize(spoken, voice), SPEAKER_RATE);
  }

  /**
   * Which devices a call reaches, and how it found its bot (spec §5.5): a voice turn's request_id, a
   * named device, the bot's name, the only bot, or with several bots the default bot.
   */
  private resolve(target: Target): Targets | Refusal {
    const approved = this.store.state.devices.filter((d) => d.status === 'approved');
    const request = target.requestId ? this.requests.get(target.requestId) : undefined;
    if (request) {
      const bot = this.store.bot(request.botId);
      const asker = this.store.device(request.deviceId);
      if (asker) return { devices: [asker], bot, request, via: 'request' };
      return { devices: approved.filter((d) => d.botId === request.botId), bot, request, via: 'request' };
    }
    if (target.device) {
      const wanted = target.device.trim().toLowerCase();
      const device = approved.find((d) => d.id.toLowerCase() === wanted || d.name.trim().toLowerCase() === wanted);
      const named = target.bot ? this.store.botByName(target.bot) : undefined;
      if (!device) return { error: `No desk device is called "${target.device}". desk_devices lists them.`, bot: named, via: named && 'bot' };
      const bot = this.store.bot(device.botId);
      if (target.bot && bot && named !== bot) {
        return { error: `The device "${device.name}" belongs to ${bot.name}, not ${target.bot}.`, bot: named, via: named && 'bot' };
      }
      return { devices: [device], bot, request: undefined, via: 'device' };
    }
    const bots = this.store.state.bots;
    let bot: Bot | undefined;
    let via: Via;
    if (target.bot) {
      bot = this.store.botByName(target.bot);
      if (!bot) return { error: `No bot called "${target.bot}" is set up on the desk bridge.` };
      via = 'bot';
    } else if (bots.length === 1) {
      bot = bots[0];
      via = 'only';
    } else if (bots.length === 0) {
      return { error: 'No bots are set up on the desk bridge yet.' };
    } else {
      // Several bots: the default one, so that the first bot's instructions need no change (spec §5.5).
      bot = this.store.bot(this.store.state.defaultBotId);
      if (!bot) return { error: 'Several bots use this desk bridge: pass your bot name in "bot".' };
      via = 'default';
    }
    const devices = approved.filter((d) => d.botId === bot.id);
    if (!devices.length) return { error: `No desk device is attached to ${bot.name}.`, bot, via };
    return { devices, bot, request: undefined, via };
  }

  /** Records a call from the bot in its turn (spec §5.11). */
  private record(
    tool: 'desk_status' | 'desk_say',
    target: Target,
    found: Targets | Refusal,
    args: { state?: string; text?: string; spoken?: number },
  ): { turn: TurnRef; event: CallEvent; started: boolean } {
    const bot = found.bot;
    return this.turns.call({
      tool,
      botId: bot?.id ?? '',
      bot: bot?.name ?? target.bot?.trim() ?? '',
      via: found.via,
      requestId: target.requestId,
      devices: 'devices' in found ? found.devices.map((d) => d.name) : [],
      ...args,
    });
  }

  /** A call that reached no device: recorded as refused, with the bridge's answer. */
  private refuse(
    record: (found: Targets | Refusal) => { event: CallEvent } | undefined,
    target: Target,
    message: string,
    found: Refusal = this.whose(target),
  ): Outcome {
    const call = record(found);
    const outcome = { ok: false, message };
    if (call) this.answer(call.event, outcome);
    return { ...outcome, bot: found.bot?.name, via: found.via };
  }

  /** For a call refused before it was resolved (a rate limit): the bot it was for, if that can be told. */
  private whose(target: Target): Refusal {
    const found = this.resolve(target);
    return 'error' in found ? found : { error: '', bot: found.bot, via: found.via };
  }

  private answer(event: CallEvent, outcome: Outcome, history?: number): void {
    event.ok = outcome.ok;
    event.answer = outcome.message;
    if (history !== undefined) event.history = history;
    this.turns.changed();
  }

  private devicesOf(bot: Bot): Device[] {
    return this.store.state.devices.filter((d) => d.status === 'approved' && d.botId === bot.id);
  }

  private open(device: Device | undefined, bot: Bot, text: string): VoiceRequest {
    const id = randomUUID();
    const request: VoiceRequest = {
      id,
      deviceId: device?.id ?? '',
      botId: bot.id,
      at: Date.now(),
      answered: false,
      timedOut: false,
      timeout: setTimeout(() => this.noAnswer(request), REPLY_TIMEOUT_MS),
      expiry: setTimeout(() => this.close(request), LATE_REPLY_MS),
      // Opened before the webhook is posted: the bot's first call can come before its answer does.
      turn: this.turns.voice({
        botId: bot.id,
        bot: bot.name,
        requestId: id,
        devices: device ? [device.name] : this.devicesOf(bot).map((d) => d.name),
        chars: text.length,
      }),
    };
    this.requests.set(request.id, request);
    return request;
  }

  private noAnswer(request: VoiceRequest): void {
    if (request.answered) return;
    request.timedOut = true;
    this.turns.noAnswer(request.turn);
    this.store.addHistory({
      kind: 'error',
      ok: false,
      deviceId: request.deviceId || undefined,
      botId: request.botId,
      detail: `no reply within ${REPLY_TIMEOUT_MS / 60_000} minutes (request ${request.id}); a later reply is still spoken`,
    });
    if (request.deviceId) this.alarm(request.deviceId, NO_ANSWER_TONE);
  }

  /** The error face, and a tone where the device's speech plays; then back to rest when the tone ends. */
  private alarm(deviceId: string, tone: Tone[]): void {
    if (!this.store.device(deviceId)) return;
    this.hub.show(deviceId, 'error');
    void this.hub.play(deviceId, Clip.of(tones(tone), SPEAKER_RATE), 'tone').then((result) => {
      // A tone's end brings the device back to rest; with no tone (muted, or nowhere to play it), a timer does.
      if (result === 'muted' || result === 'offline') setTimeout(() => this.showResting(deviceId), 3000).unref();
    });
  }

  private hasOpenRequest(deviceId: string): boolean {
    for (const r of this.requests.values()) {
      if (r.deviceId === deviceId && !r.answered && !r.timedOut) return true;
    }
    return false;
  }

  /**
   * What the bot reported, kept until it reports something else or replies. "Thinking" and "working"
   * expire after ten minutes. "Waiting" is attention (spec §4.3.1): it doesn't expire, it is kept with
   * the device (so a restart keeps it), and a chirp plays once when it starts.
   */
  private setBotState(deviceId: string, state: BotState, turn?: TurnRef): void {
    clearTimeout(this.statusTimers.get(deviceId));
    this.statusTimers.delete(deviceId);
    this.botStates.set(deviceId, state);
    const device = this.store.device(deviceId);
    if (state === 'waiting') {
      if (device && !device.attention) {
        device.attention = new Date().toISOString();
        this.store.changed();
        if (turn) this.turns.attention(turn, device.name, 'started');
        void this.hub.play(deviceId, Clip.of(attentionChirp(), SPEAKER_RATE), 'tone'); // not when muted, nor with nowhere to play
      }
      return;
    }
    if (device?.attention) {
      device.attention = undefined;
      this.store.changed();
      if (turn) this.turns.attention(turn, device.name, 'ended');
    }
    if (state === 'idle') return;
    this.statusTimers.set(
      deviceId,
      setTimeout(() => {
        this.botStates.set(deviceId, 'idle');
        this.showResting(deviceId);
      }, this.statusExpiryMs),
    );
  }

  /** The state a device shows between speech: the bot's own report first, then a voice message
   * still waiting for its reply, else idle. */
  private showResting(deviceId: string): void {
    const reported = this.botStates.get(deviceId) ?? 'idle';
    if (reported !== 'idle') this.hub.show(deviceId, reported);
    else this.hub.show(deviceId, this.hasOpenRequest(deviceId) ? 'thinking' : 'idle');
  }

  private remember(deviceId: string, who: 'owner' | 'bot', text: string): void {
    const list = this.recent.get(deviceId) ?? [];
    list.push({ who, text: text.slice(0, 500) });
    this.recent.set(deviceId, list.slice(-RECENT_LIMIT));
  }

  private fail(device: Device | undefined, bot: Bot | undefined, detail: string, text?: string): Outcome {
    this.log.warn({ device: device?.id, bot: bot?.name }, detail);
    this.store.addHistory({ kind: 'error', ok: false, deviceId: device?.id, botId: bot?.id, text, detail });
    if (device) this.alarm(device.id, ERROR_TONE);
    return { ok: false, message: detail.charAt(0).toUpperCase() + detail.slice(1) + '.' };
  }
}

function names(devices: Device[]): string {
  return devices.map((d) => d.name).join(', ');
}
