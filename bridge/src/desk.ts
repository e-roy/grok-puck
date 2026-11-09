// What the desk does: hands what the owner says to their bot, and speaks and shows what the bot
// sends back. The hub moves the bytes; this decides what goes where.
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { ERROR_TONE, MIC_RATE, NO_ANSWER_TONE, SPEAKER_RATE, tones, wav } from './audio.ts';
import { Clip } from './clip.ts';
import { postWebhook, type VoiceMessage } from './grokbot.ts';
import type { DeviceHub } from './hub.ts';
import { RateLimit } from './ratelimit.ts';
import { speakable } from './speakable.ts';
import { makeStt, makeTts } from './speech.ts';
import type { Bot, Device, Store } from './store.ts';

const REPLY_TIMEOUT_MS = 180_000; // then the device shows "no answer"
const LATE_REPLY_MS = 3_600_000; // a reply this late still finds its device
const STATUS_EXPIRY_MS = 600_000; // a "working" the bot never ended
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
}

interface Targets {
  devices: Device[];
  bot: Bot | undefined;
  request: VoiceRequest | undefined;
}

export class Desk {
  private readonly store: Store;
  private readonly hub: DeviceHub;
  private readonly log: FastifyBaseLogger;
  private readonly requests = new Map<string, VoiceRequest>();
  private readonly offline = new Map<string, Array<{ text: string; botId: string }>>();
  private readonly recent = new Map<string, Array<{ who: 'owner' | 'bot'; text: string }>>();
  private readonly lastSpoken = new Map<string, { text: string; at: number }>();
  private readonly botStates = new Map<string, BotState>(); // what the bot last reported, per device
  private readonly statusTimers = new Map<string, NodeJS.Timeout>();
  private readonly limits = { voice: new RateLimit(60), say: new RateLimit(120), status: new RateLimit(600) };

  constructor(store: Store, hub: DeviceHub, log: FastifyBaseLogger) {
    this.store = store;
    this.hub = hub;
    this.log = log;
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
    if (!bot.webhookUrl) {
      return this.fail(device, bot, `${bot.name} has no webhook URL yet (it is the Grok Bot routine's webhook, set under Bots)`, text);
    }
    if (!this.limits.voice.take()) return this.fail(device, bot, 'too many voice messages this hour');
    if (device && this.hub.shown(device.id) !== 'thinking') this.hub.show(device.id, 'thinking');
    const request = this.open(device, bot);
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
  say(text: string, target: Target, { allowRepeat = false } = {}): Outcome {
    if (!this.limits.say.take()) return { ok: false, message: 'Too many desk_say calls this hour; try again later.' };
    const found = this.resolve(target);
    if ('error' in found) return { ok: false, message: found.error };
    const { devices, bot, request } = found;
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
      // A reply ends "thinking" and "working"; "waiting" stays, since the reply may be the question.
      if (this.botStates.get(device.id) !== 'waiting') this.setBotState(device.id, 'idle');
      if (device.muted) this.showResting(device.id);
    }
    const spoken = speakable(text);
    if (!spoken) {
      for (const device of devices) this.showResting(device.id);
      this.store.addHistory({ kind: 'say', ok: true, botId: bot?.id, text, timings, detail: 'nothing to speak (only code or links)' });
      return { ok: true, message: 'Nothing was spoken: the text was only code or links.' };
    }
    // Without a voice nothing can be spoken: say so now rather than fail later, or keep it for later.
    const noVoice = this.voiceProblem(bot, devices);
    if (noVoice) {
      let outcome: Outcome = { ok: false, message: noVoice };
      for (const device of devices) outcome = this.fail(device, bot, noVoice, text);
      return outcome;
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
    );
    const message = [report, repeats.length ? `Already spoken on ${names(repeats)} a moment ago.` : ''].filter(Boolean).join(' ');
    this.store.addHistory({
      kind: 'say',
      ok: true,
      botId: bot?.id,
      deviceId: devices.length === 1 ? devices[0].id : undefined,
      text,
      timings,
      detail: message,
    });
    return { ok: true, message };
  }

  /** What the bot is doing, shown on its devices. */
  status(state: BotState, target: Target): Outcome {
    if (!this.limits.status.take()) return { ok: false, message: 'Too many desk_status calls this hour.' };
    const found = this.resolve(target);
    if ('error' in found) return { ok: false, message: found.error };
    for (const device of found.devices) {
      this.setBotState(device.id, state);
      this.showResting(device.id);
    }
    return { ok: true, message: `Showing "${state}" on ${names(found.devices)}.` };
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

  /** A device (re)connected: show the right state and speak what it missed. */
  onConnected(device: Device): void {
    this.showResting(device.id);
    const missed = this.offline.get(device.id) ?? [];
    this.offline.delete(device.id);
    for (const item of missed) this.speak([device], this.store.bot(item.botId), item.text);
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

  private speak(devices: Device[], bot: Bot | undefined, spoken: string): string {
    const online = devices.filter((d) => this.hub.isOnline(d.id) && !d.muted);
    const away = devices.filter((d) => !this.hub.isOnline(d.id) && !d.muted);
    const muted = devices.filter((d) => d.muted);
    for (const device of away) {
      const queue = this.offline.get(device.id) ?? [];
      queue.push({ text: spoken, botId: bot?.id ?? device.botId });
      this.offline.set(device.id, queue.slice(-OFFLINE_QUEUE));
    }
    if (online.length) {
      const clip = this.synthesize(spoken, bot);
      const at = Date.now();
      clip.settled.catch((err: unknown) => {
        for (const device of online) {
          // Not spoken after all, so the same text may be tried again at once.
          if (this.lastSpoken.get(device.id)?.at === at) this.lastSpoken.delete(device.id);
          this.fail(device, bot, `text-to-speech failed: ${errorText(err)}`, spoken);
        }
      });
      for (const device of online) {
        this.lastSpoken.set(device.id, { text: spoken, at });
        void this.hub.play(device.id, clip, 'speech');
      }
    }
    return [
      online.length ? `Speaking on ${names(online)}.` : '',
      away.length ? `Saved for ${names(away)} (offline); spoken when it reconnects.` : '',
      muted.length ? `${names(muted)} ${muted.length > 1 ? 'are' : 'is'} muted.` : '',
    ]
      .filter(Boolean)
      .join(' ');
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

  private resolve(target: Target): Targets | { error: string } {
    const approved = this.store.state.devices.filter((d) => d.status === 'approved');
    const request = target.requestId ? this.requests.get(target.requestId) : undefined;
    if (request) {
      const bot = this.store.bot(request.botId);
      const asker = this.store.device(request.deviceId);
      if (asker) return { devices: [asker], bot, request };
      return { devices: approved.filter((d) => d.botId === request.botId), bot, request };
    }
    if (target.device) {
      const wanted = target.device.trim().toLowerCase();
      const device = approved.find((d) => d.id.toLowerCase() === wanted || d.name.trim().toLowerCase() === wanted);
      if (!device) return { error: `No desk device is called "${target.device}". desk_devices lists them.` };
      const bot = this.store.bot(device.botId);
      if (target.bot && bot && this.store.botByName(target.bot) !== bot) {
        return { error: `The device "${device.name}" belongs to ${bot.name}, not ${target.bot}.` };
      }
      return { devices: [device], bot, request: undefined };
    }
    const bots = this.store.state.bots;
    let bot: Bot | undefined;
    if (target.bot) {
      bot = this.store.botByName(target.bot);
      if (!bot) return { error: `No bot called "${target.bot}" is set up on the desk bridge.` };
    } else if (bots.length === 1) {
      bot = bots[0];
    } else if (bots.length === 0) {
      return { error: 'No bots are set up on the desk bridge yet.' };
    } else {
      return { error: 'Several bots use this desk bridge: pass your bot name in "bot".' };
    }
    const devices = approved.filter((d) => d.botId === bot.id);
    if (!devices.length) return { error: `No desk device is attached to ${bot.name}.` };
    return { devices, bot, request: undefined };
  }

  private open(device: Device | undefined, bot: Bot): VoiceRequest {
    const request: VoiceRequest = {
      id: randomUUID(),
      deviceId: device?.id ?? '',
      botId: bot.id,
      at: Date.now(),
      answered: false,
      timedOut: false,
      timeout: setTimeout(() => this.noAnswer(request), REPLY_TIMEOUT_MS),
      expiry: setTimeout(() => this.close(request), LATE_REPLY_MS),
    };
    this.requests.set(request.id, request);
    return request;
  }

  private noAnswer(request: VoiceRequest): void {
    if (request.answered) return;
    request.timedOut = true;
    this.store.addHistory({
      kind: 'error',
      ok: false,
      deviceId: request.deviceId || undefined,
      botId: request.botId,
      detail: `no reply within ${REPLY_TIMEOUT_MS / 60_000} minutes (request ${request.id}); a later reply is still spoken`,
    });
    if (!this.hub.isOnline(request.deviceId)) return;
    this.hub.show(request.deviceId, 'error');
    void this.hub.play(request.deviceId, Clip.of(tones(NO_ANSWER_TONE), SPEAKER_RATE), 'tone');
  }

  private hasOpenRequest(deviceId: string): boolean {
    for (const r of this.requests.values()) {
      if (r.deviceId === deviceId && !r.answered && !r.timedOut) return true;
    }
    return false;
  }

  /** What the bot reported, kept until it reports something else, replies, or ten minutes pass. */
  private setBotState(deviceId: string, state: BotState): void {
    clearTimeout(this.statusTimers.get(deviceId));
    this.statusTimers.delete(deviceId);
    this.botStates.set(deviceId, state);
    if (state === 'idle') return;
    this.statusTimers.set(
      deviceId,
      setTimeout(() => {
        this.botStates.set(deviceId, 'idle');
        this.showResting(deviceId);
      }, STATUS_EXPIRY_MS),
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
    if (device && this.hub.isOnline(device.id)) {
      this.hub.show(device.id, 'error');
      // The tone's end brings the device back to rest; a muted device gets there on a timer.
      if (device.muted) setTimeout(() => this.showResting(device.id), 3000);
      else void this.hub.play(device.id, Clip.of(tones(ERROR_TONE), SPEAKER_RATE), 'tone');
    }
    return { ok: false, message: detail.charAt(0).toUpperCase() + detail.slice(1) + '.' };
  }
}

function names(devices: Device[]): string {
  return devices.map((d) => d.name).join(', ');
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
