// A stand-in for Grok Bot. It receives the routine webhook as a Grok Bot routine would, then answers
// through the bridge's MCP tools as the bot would, so the whole loop can be tried locally.
//
//   pnpm fake-grokbot --mcp-key <key> [--bridge http://127.0.0.1:8787] [--port 8790] [--webhook-key test-key]
//                     [--bot "Test Bot"] [--voice good|quick|ask|silent|skip-thinking|no-reply|repeat|no-request-id]
//
// In the admin page, set the bot's webhook URL to http://127.0.0.1:8790/webhook and its key to the
// same --webhook-key. Then type `turn <behaviour> [text]` (a typed message answered as a bot would:
// following its instructions, or missing parts of them, for the turn records), `say <text>` (the bot
// speaks on its own), `status <state>`, `devices` or `quit`. --bot passes that name in every call,
// as a second bot's instructions say; --voice is how it answers what is said at the desk (good: as
// the instructions ask).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface WebhookCall {
  authorization: string;
  body: Record<string, unknown>;
}

export interface ToolAnswer {
  text: string;
  isError: boolean;
}

/** How the fake bot answers a message: as its standing instructions ask, or missing parts of them. */
export const BEHAVIOURS = {
  good: 'thinking, working, then the reply',
  quick: 'thinking, then the reply (no tools)',
  ask: 'thinking, waiting, then a question',
  silent: 'thinking, working, then idle without a reply',
  'skip-thinking': 'working, then the reply, without thinking first',
  'no-reply': 'thinking and working, then nothing',
  repeat: 'thinking three times in a row, then the reply',
  'no-request-id': 'thinking, then the reply without the request_id',
} as const;
export type Behaviour = keyof typeof BEHAVIOURS;

export function isBehaviour(value: string): value is Behaviour {
  return Object.hasOwn(BEHAVIOURS, value);
}

export class FakeGrokBot {
  readonly received: WebhookCall[] = [];
  url = '';
  private readonly mcpUrl: string;
  private readonly mcpKey: string;
  private readonly webhookKey: string;
  private readonly port: number;
  private readonly replyDelayMs: number;
  /** The name it passes in every call (`bot`), as a second bot's instructions say; none: it names no bot. */
  bot: string | undefined;
  /** How it answers what is said at the desk. */
  voice: Behaviour;
  private server: http.Server | undefined;

  constructor(options: {
    mcpUrl: string;
    mcpKey: string;
    webhookKey: string;
    port?: number;
    replyDelayMs?: number;
    bot?: string;
    voice?: Behaviour;
  }) {
    this.mcpUrl = options.mcpUrl;
    this.mcpKey = options.mcpKey;
    this.webhookKey = options.webhookKey;
    this.port = options.port ?? 0;
    this.replyDelayMs = options.replyDelayMs ?? 1500;
    this.bot = options.bot;
    this.voice = options.voice ?? 'good';
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => void this.onRequest(req, res));
    await new Promise<void>((resolve) => this.server!.listen(this.port, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/webhook`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  /** Calls one of the bridge's tools, as Grok Bot would. */
  async call(name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    const client = new Client({ name: 'fake-grokbot', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(this.mcpUrl), {
      requestInit: { headers: { Authorization: `Bearer ${this.mcpKey}` } },
    });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name, arguments: args });
      const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
      return { text: content.map((c) => c.text ?? '').join('\n'), isError: Boolean(result.isError) };
    } finally {
      await client.close();
    }
  }

  async listTools(): Promise<string[]> {
    const client = new Client({ name: 'fake-grokbot', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(this.mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${this.mcpKey}` } } }),
    );
    try {
      return (await client.listTools()).tools.map((t) => t.name);
    } finally {
      await client.close();
    }
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'POST' || req.url !== '/webhook') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${this.webhookKey}`) {
      res.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    this.received.push({ authorization: req.headers.authorization, body });
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    void this.answer(body).catch((err: unknown) => console.error('fake Grok Bot could not answer:', err));
  }

  /** What a routine run does: answers what was said at the desk, with its request_id, as `voice` says. */
  private async answer(body: Record<string, unknown>): Promise<void> {
    await this.turn(this.voice, String(body.text ?? ''), String(body.request_id ?? ''));
  }

  /**
   * Answers one message as a bot would, in a way its instructions ask or not (BEHAVIOURS). With a
   * request_id it answers what was said at the desk; without, a message typed in the app.
   */
  async turn(behaviour: Behaviour, text: string, requestId?: string): Promise<ToolAnswer[]> {
    const answers: ToolAnswer[] = [];
    const target = (withRequest = true) => ({
      ...(this.bot ? { bot: this.bot } : {}),
      ...(requestId && withRequest ? { request_id: requestId } : {}),
    });
    const status = async (state: string) => answers.push(await this.call('desk_status', { state, ...target() }));
    const say = async (words: string, withRequest = true) => answers.push(await this.call('desk_say', { text: words, ...target(withRequest) }));
    const pause = () => new Promise((resolve) => setTimeout(resolve, this.replyDelayMs));
    const reply = requestId ? `You said: ${text}` : `Here is my answer to: ${text}`;
    switch (behaviour) {
      case 'good':
        await status('thinking');
        await status('working');
        await pause();
        await say(reply);
        break;
      case 'quick':
        await status('thinking');
        await pause();
        await say(reply);
        break;
      case 'ask':
        await status('thinking');
        await status('waiting');
        await say(`Before I go on: which one do you want, ${text || 'this or that'}?`);
        break;
      case 'silent':
        await status('thinking');
        await status('working');
        await pause();
        await status('idle');
        break;
      case 'skip-thinking':
        await status('working');
        await pause();
        await say(reply);
        break;
      case 'no-reply':
        await status('thinking');
        await status('working');
        break;
      case 'repeat':
        for (let i = 0; i < 3; i++) await status('thinking');
        await pause();
        await say(reply);
        break;
      case 'no-request-id':
        await status('thinking');
        await pause();
        await say(reply, false);
        break;
    }
    return answers;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      bridge: { type: 'string', default: 'http://127.0.0.1:8787' },
      'mcp-key': { type: 'string' },
      port: { type: 'string', default: '8790' },
      'webhook-key': { type: 'string', default: 'test-key' },
      bot: { type: 'string' },
      voice: { type: 'string', default: 'good' },
    },
  });
  if (!isBehaviour(values.voice)) {
    console.error(`--voice is one of: ${Object.keys(BEHAVIOURS).join(', ')}`);
    process.exit(1);
  }
  if (!values['mcp-key']) {
    console.error('Pass --mcp-key: create one in the admin page (MCP → Create key).');
    process.exit(1);
  }
  const bot = new FakeGrokBot({
    mcpUrl: `${values.bridge.replace(/\/+$/, '')}/mcp`,
    mcpKey: values['mcp-key'],
    webhookKey: values['webhook-key'],
    port: Number(values.port),
    bot: values.bot,
    voice: values.voice,
  });
  await bot.start();
  const say = (...parts: unknown[]) => console.log(`[${new Date().toLocaleTimeString()}]`, ...parts);
  say(`fake Grok Bot listening. Webhook URL: ${bot.url}  key: ${values['webhook-key']}`);
  say('tools on the bridge:', (await bot.listTools()).join(', '));
  say(bot.bot ? `it names itself "${bot.bot}" in every call` : 'it names no bot in its calls', `· it answers the desk: ${bot.voice}`);
  say('commands: turn <behaviour> [text] | say <text> | status <thinking|working|waiting|idle> | devices | quit');
  say('behaviours:', Object.entries(BEHAVIOURS).map(([name, what]) => `${name} (${what})`).join('; '));

  const input = readline.createInterface({ input: process.stdin });
  input.on('line', (line) => {
    const [command, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(' ');
    const named = bot.bot ? { bot: bot.bot } : {};
    const show = (answer: ToolAnswer) => say(answer.isError ? 'error:' : 'ok:', answer.text);
    const run = (name: string, args: Record<string, unknown>) => bot.call(name, args).then(show, (err: unknown) => say('failed:', err));
    if (command === 'turn' && rest[0] && isBehaviour(rest[0])) {
      const text = rest.slice(1).join(' ') || 'a typed question';
      void bot.turn(rest[0], text).then((answers) => answers.forEach(show), (err: unknown) => say('failed:', err));
    } else if (command === 'turn') say(`turn takes one of: ${Object.keys(BEHAVIOURS).join(', ')}`);
    else if (command === 'say' && arg) void run('desk_say', { text: arg, ...named });
    else if (command === 'status' && arg) void run('desk_status', { state: arg, ...named });
    else if (command === 'devices') void run('desk_devices', {});
    else if (command === 'quit') void bot.stop().then(() => process.exit(0));
    else if (command) say('commands: turn <behaviour> [text] | say <text> | status <state> | devices | quit');
  });
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) await main();
