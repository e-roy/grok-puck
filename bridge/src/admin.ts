// The admin page and its API, on their own port. Locally that port only answers this computer; behind
// the tunnel every request must carry a valid Cloudflare Access login.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { accessVerifier } from './access.ts';
import { wav } from './audio.ts';
import { Clip } from './clip.ts';
import { errorText } from './errors.ts';
import type { Config } from './config.ts';
import type { Desk } from './desk.ts';
import { webhookUrlProblem } from './grokbot.ts';
import type { DeviceHub } from './hub.ts';
import { hashKey, masked, newKey } from './keys.ts';
import type { McpActivity } from './mcp.ts';
import { DISPLAY_STATES } from './protocol.ts';
import { checkTtsModels, listModels, makeTts } from './speech.ts';
import { AVATAR_SHAPES, type Bot, type SpeechService, type Store } from './store.ts';

export interface AdminContext {
  config: Config;
  store: Store;
  hub: DeviceHub;
  desk: Desk;
  activity: McpActivity;
  publicPort: number;
}

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const DIST = fileURLToPath(new URL('../admin/dist/', import.meta.url));

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour like #f59e0b');
const BotFields = z.object({
  name: z.string().trim().min(1).max(100),
  webhookUrl: z.string().trim().max(2000),
  webhookKey: z.string().max(500),
  avatar: z.object({ shape: z.enum(AVATAR_SHAPES), color: Color }),
  voice: z.string().max(100),
  sendRecent: z.boolean(),
});
const BotPatch = BotFields.partial();
const DevicePatch = z
  .object({
    name: z.string().trim().min(1).max(64),
    botId: z.string().max(64),
    volume: z.number().int().min(0).max(100),
    muted: z.boolean(),
    timings: z.object({ maxListenMs: z.number().int().min(5000).max(120_000) }).partial(),
  })
  .partial();
const ServiceFields = {
  provider: z.enum(['openai', 'mock']),
  baseUrl: z.string().trim().max(500),
  apiKey: z.string().max(500), // empty = keep the stored key
  clearApiKey: z.boolean(),
  model: z.string().trim().max(200),
};
const SpeechPatch = z
  .object({
    tts: z.object(ServiceFields).partial(),
    stt: z.object({ ...ServiceFields, language: z.string().trim().max(10), mockText: z.string().max(500) }).partial(),
  })
  .partial();

export async function registerAdmin(app: FastifyInstance, ctx: AdminContext): Promise<void> {
  const { config, store, hub, desk } = ctx;
  const verify = config.adminAuth === 'cloudflare-access' ? accessVerifier(config.accessTeamDomain, config.accessAud) : null;

  app.addHook('onRequest', async (req, reply) => {
    if (verify) {
      const header = req.headers['cf-access-jwt-assertion'];
      const token = typeof header === 'string' ? header : cookie(req, 'CF_Authorization');
      if (!(await verify(token))) return deny(reply, 'a Cloudflare Access login is required');
    } else {
      // Local mode: only this computer, and only under a local host name (stops DNS-rebinding pages).
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (!LOOPBACK_IPS.has(req.ip) || !LOOPBACK_HOSTS.has(host)) return deny(reply, 'local access only');
    }
    // A custom header can't be sent cross-site without a CORS preflight, which this API never allows.
    if (req.url.startsWith('/api/') && req.method !== 'GET' && req.headers['x-desk-admin'] !== '1') {
      return deny(reply, 'missing x-desk-admin header');
    }
  });

  app.get('/api/overview', async () => overview(ctx));

  app.post('/api/mcp-key', async () => {
    const key = newKey();
    const replaced = Boolean(store.state.mcpKeyHash);
    Object.assign(store.state, { mcpKeyHash: hashKey(key), mcpKeyEnd: key.slice(-4), mcpKeyCreatedAt: new Date().toISOString() });
    store.addHistory({ kind: 'admin', ok: true, detail: replaced ? 'new MCP key created; the old one no longer works' : 'MCP key created' });
    return { key };
  });

  app.delete('/api/mcp-key', async () => {
    Object.assign(store.state, { mcpKeyHash: '', mcpKeyEnd: '', mcpKeyCreatedAt: '' });
    store.addHistory({ kind: 'admin', ok: true, detail: 'MCP key revoked; Grok Bot can no longer call the bridge' });
    return { ok: true };
  });

  app.post('/api/bots', async (req, reply) => {
    const body = parse(BotPatch.required({ name: true }), req.body, reply);
    if (!body) return;
    const problem = body.webhookUrl ? webhookUrlProblem(body.webhookUrl) : null;
    if (problem) return bad(reply, `Webhook URL ${problem}.`);
    if (store.botByName(body.name)) return bad(reply, `A bot called "${body.name}" already exists.`);
    const bot: Bot = {
      id: newKey().slice(0, 10),
      name: body.name,
      webhookUrl: body.webhookUrl ?? '',
      webhookKey: body.webhookKey ?? '',
      avatar: body.avatar ?? { shape: 'blob', color: '#9ca3af' },
      voice: body.voice ?? '',
      sendRecent: body.sendRecent ?? false,
    };
    store.state.bots.push(bot);
    // A device without a bot can't speak, so a new bot is chosen for those.
    const chosen = store.state.devices.filter((d) => d.status === 'approved' && !store.bot(d.botId));
    for (const device of chosen) {
      device.botId = bot.id;
      hub.sendConfig(device);
    }
    store.changed();
    const where = chosen.length ? ` and chosen for ${chosen.map((d) => d.name).join(', ')}` : '';
    return { id: bot.id, message: `${bot.name} added${where}: now set its avatar and voice.` };
  });

  app.patch('/api/bots/:id', async (req, reply) => {
    const bot = store.bot(param(req, 'id'));
    if (!bot) return notFound(reply);
    const body = parse(BotPatch, req.body, reply);
    if (!body) return;
    const problem = body.webhookUrl ? webhookUrlProblem(body.webhookUrl) : null;
    if (problem) return bad(reply, `Webhook URL ${problem}.`);
    if (body.name && store.botByName(body.name) && store.botByName(body.name) !== bot) {
      return bad(reply, `A bot called "${body.name}" already exists.`);
    }
    const { webhookKey, ...rest } = body;
    Object.assign(bot, rest);
    if (webhookKey) bot.webhookKey = webhookKey;
    store.changed();
    for (const device of store.state.devices) if (device.botId === bot.id) hub.sendConfig(device);
    return { ok: true };
  });

  app.delete('/api/bots/:id', async (req, reply) => {
    const bot = store.bot(param(req, 'id'));
    if (!bot) return notFound(reply);
    store.state.bots = store.state.bots.filter((b) => b !== bot);
    for (const device of store.state.devices) {
      if (device.botId !== bot.id) continue;
      device.botId = '';
      hub.sendConfig(device);
    }
    store.changed();
    return { ok: true };
  });

  app.post('/api/bots/:id/test', async (req, reply) => {
    const bot = store.bot(param(req, 'id'));
    if (!bot) return notFound(reply);
    const body = parse(z.object({ text: z.string().trim().min(1).max(1000) }), req.body, reply);
    if (!body) return;
    const attached = store.state.devices.filter((d) => d.status === 'approved' && d.botId === bot.id);
    const device = attached.find((d) => hub.isOnline(d.id)) ?? attached[0];
    const outcome = await desk.sendToBot(device, bot, body.text);
    return outcome.ok ? outcome : bad(reply, outcome.message);
  });

  app.post('/api/devices/:id/approve', async (req, reply) => {
    const body = parse(z.object({ botId: z.string().max(64).optional(), name: z.string().trim().min(1).max(64).optional() }), req.body, reply);
    if (!body) return;
    if (body.botId && !store.bot(body.botId)) return bad(reply, 'Unknown bot.');
    const problem = hub.approve(param(req, 'id'), body);
    if (problem) return bad(reply, problem.charAt(0).toUpperCase() + problem.slice(1) + '.');
    store.addHistory({ kind: 'device', ok: true, deviceId: param(req, 'id'), detail: 'approved' });
    return { ok: true };
  });

  app.patch('/api/devices/:id', async (req, reply) => {
    const device = store.device(param(req, 'id'));
    if (!device) return notFound(reply);
    const body = parse(DevicePatch, req.body, reply);
    if (!body) return;
    if (body.botId && !store.bot(body.botId)) return bad(reply, 'Unknown bot.');
    const { timings, ...rest } = body;
    Object.assign(device, rest);
    if (timings) device.timings = { ...device.timings, ...timings };
    store.changed();
    hub.sendConfig(device);
    return { ok: true };
  });

  app.delete('/api/devices/:id', async (req, reply) => {
    const id = param(req, 'id');
    if (!store.device(id)) return notFound(reply);
    hub.forget(id);
    store.addHistory({ kind: 'device', ok: true, deviceId: id, detail: 'forgotten' });
    return { ok: true };
  });

  app.post('/api/devices/:id/forget-wifi', async (req, reply) => {
    const device = store.device(param(req, 'id'));
    if (!device) return notFound(reply);
    if (!hub.forgetWifi(device.id)) return bad(reply, 'The device must be online to receive this.');
    store.addHistory({ kind: 'device', ok: true, deviceId: device.id, detail: 'told to forget its Wi-Fi' });
    return { ok: true };
  });

  app.post('/api/devices/:id/say', async (req, reply) => {
    const device = store.device(param(req, 'id'));
    if (!device) return notFound(reply);
    const body = parse(z.object({ text: z.string().trim().min(1).max(2000) }), req.body, reply);
    if (!body) return;
    const outcome = desk.say(body.text, { device: device.id }, { allowRepeat: true });
    return outcome.ok ? outcome : bad(reply, outcome.message);
  });

  app.post('/api/devices/:id/show', async (req, reply) => {
    const device = store.device(param(req, 'id'));
    if (!device) return notFound(reply);
    const body = parse(z.object({ state: z.enum(DISPLAY_STATES) }), req.body, reply);
    if (!body) return;
    hub.show(device.id, body.state);
    return { ok: true };
  });

  app.put('/api/speech', async (req, reply) => {
    const body = parse(SpeechPatch, req.body, reply);
    if (!body) return;
    for (const which of ['tts', 'stt'] as const) {
      const patch = body[which];
      if (!patch) continue;
      if (patch.baseUrl && !/^https?:\/\/[^\s]+$/.test(patch.baseUrl)) return bad(reply, `The ${which.toUpperCase()} base URL must start with http:// or https://.`);
      const { apiKey, clearApiKey, ...rest } = patch;
      const service: SpeechService = store.state.speech[which];
      Object.assign(service, rest);
      if (apiKey) service.apiKey = apiKey;
      if (clearApiKey) service.apiKey = '';
    }
    store.changed();
    return { ok: true };
  });

  // The models a speech service offers. Uses the URL (and key, if typed) from the form, so it works
  // before saving; without a typed key it uses the saved one.
  app.post('/api/speech/models', async (req, reply) => {
    const body = parse(
      z.object({ which: z.enum(['tts', 'stt']), baseUrl: z.string().trim().max(500), apiKey: z.string().max(500).optional() }),
      req.body,
      reply,
    );
    if (!body) return;
    if (!/^https?:\/\/[^\s]+$/.test(body.baseUrl)) return bad(reply, 'Enter the base URL first (it starts with http:// or https://).');
    const saved = store.state.speech[body.which];
    const service: SpeechService = { ...saved, provider: 'openai', baseUrl: body.baseUrl, apiKey: body.apiKey || saved.apiKey };
    try {
      const found = await listModels(service, body.which);
      if (found && body.which === 'tts' && found.models.length) {
        return { baseUrl: found.baseUrl, ...(await checkTtsModels({ ...service, baseUrl: found.baseUrl }, found.models)) };
      }
      if (found) return found;
      const hint = /\/v1\/?$/.test(body.baseUrl) ? '' : ' (OpenAI-style base URLs usually end in /v1.)';
      return { models: [], baseUrl: body.baseUrl, message: `This service has no model list: type the model name.${hint}` };
    } catch (err) {
      return bad(reply, `Couldn't get the model list: ${errorText(err)}`);
    }
  });

  app.get('/api/voices', async () => {
    try {
      return { voices: await makeTts(store.state.speech.tts).voices() };
    } catch (err) {
      return { voices: [], error: errorText(err) };
    }
  });

  app.post('/api/tts/sample', async (req, reply) => {
    const body = parse(z.object({ voice: z.string().max(100), text: z.string().trim().min(1).max(500) }), req.body, reply);
    if (!body) return;
    try {
      const clip = Clip.from(makeTts(store.state.speech.tts).synthesize(body.text, body.voice), 24_000);
      const pcm = await clip.all();
      return reply.type('audio/wav').send(wav(pcm, clip.sampleRate));
    } catch (err) {
      return reply.code(502).send({ error: errorText(err) });
    }
  });

  if (fs.existsSync(DIST)) {
    await app.register(fastifyStatic, { root: DIST });
  } else {
    app.get('/', async (_req, reply) =>
      reply.type('text/plain').send('The admin page is not built yet. In bridge/, run: pnpm build:admin'),
    );
  }
}

function overview(ctx: AdminContext) {
  const { store, hub, config, activity } = ctx;
  const s = store.state;
  const service = (svc: SpeechService) => ({ ...svc, apiKey: masked(svc.apiKey), apiKeySet: Boolean(svc.apiKey) });
  return {
    devices: s.devices.map(({ keyHash: _hidden, ...d }) => ({
      ...d,
      online: hub.isOnline(d.id),
      waiting: hub.isWaiting(d.id),
      showing: hub.shown(d.id) ?? null,
    })),
    bots: s.bots.map((b) => ({ ...b, webhookKey: masked(b.webhookKey), webhookKeySet: Boolean(b.webhookKey) })),
    speech: { tts: service(s.speech.tts), stt: { ...service(s.speech.stt), language: s.speech.stt.language, mockText: s.speech.stt.mockText } },
    mcp: {
      keySet: Boolean(s.mcpKeyHash),
      keyEnd: s.mcpKeyHash ? s.mcpKeyEnd : '',
      keyCreatedAt: s.mcpKeyHash ? s.mcpKeyCreatedAt : '',
      url: config.publicBaseUrl ? `${config.publicBaseUrl}/mcp` : `http://<this computer>:${ctx.publicPort}/mcp`,
      calls: activity.calls,
    },
    history: s.history.slice(0, 100),
    shapes: AVATAR_SHAPES,
    displayStates: DISPLAY_STATES,
  };
}

function parse<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  void bad(reply, `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}`);
  return undefined;
}

function param(req: FastifyRequest, name: string): string {
  return String((req.params as Record<string, unknown>)[name] ?? '');
}

function cookie(req: FastifyRequest, name: string): string | undefined {
  const match = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

function bad(reply: FastifyReply, error: string) {
  return reply.code(400).send({ error });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: 'Not found.' });
}

function deny(reply: FastifyReply, error: string) {
  return reply.code(403).send({ error });
}
