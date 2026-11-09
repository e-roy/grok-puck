// A stand-in for Grok Bot. It receives the routine webhook as a Grok Bot routine would, then answers
// through the bridge's MCP tools as the bot would, so the whole loop can be tried locally.
//
//   pnpm fake-grokbot --mcp-key <key> [--bridge http://127.0.0.1:8787] [--port 8790] [--webhook-key test-key]
//
// In the admin page, set the bot's webhook URL to http://127.0.0.1:8790/webhook and its key to the
// same --webhook-key. Then type `say <text>` (the bot speaks on its own), `status <state>`,
// `devices` or `quit`.
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

export class FakeGrokBot {
  readonly received: WebhookCall[] = [];
  url = '';
  private readonly mcpUrl: string;
  private readonly mcpKey: string;
  private readonly webhookKey: string;
  private readonly port: number;
  private readonly replyDelayMs: number;
  private server: http.Server | undefined;

  constructor(options: { mcpUrl: string; mcpKey: string; webhookKey: string; port?: number; replyDelayMs?: number }) {
    this.mcpUrl = options.mcpUrl;
    this.mcpKey = options.mcpKey;
    this.webhookKey = options.webhookKey;
    this.port = options.port ?? 0;
    this.replyDelayMs = options.replyDelayMs ?? 1500;
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

  /** What a routine run does: show it is working, then reply with desk_say and the request_id. */
  private async answer(body: Record<string, unknown>): Promise<void> {
    const requestId = String(body.request_id ?? '');
    await this.call('desk_status', { state: 'working', request_id: requestId });
    await new Promise((resolve) => setTimeout(resolve, this.replyDelayMs));
    await this.call('desk_say', { text: `You said: ${String(body.text ?? '')}`, request_id: requestId });
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      bridge: { type: 'string', default: 'http://127.0.0.1:8787' },
      'mcp-key': { type: 'string' },
      port: { type: 'string', default: '8790' },
      'webhook-key': { type: 'string', default: 'test-key' },
    },
  });
  if (!values['mcp-key']) {
    console.error('Pass --mcp-key: create one in the admin page (MCP → Create key).');
    process.exit(1);
  }
  const bot = new FakeGrokBot({
    mcpUrl: `${values.bridge.replace(/\/+$/, '')}/mcp`,
    mcpKey: values['mcp-key'],
    webhookKey: values['webhook-key'],
    port: Number(values.port),
  });
  await bot.start();
  const say = (...parts: unknown[]) => console.log(`[${new Date().toLocaleTimeString()}]`, ...parts);
  say(`fake Grok Bot listening. Webhook URL: ${bot.url}  key: ${values['webhook-key']}`);
  say('tools on the bridge:', (await bot.listTools()).join(', '));
  say('commands: say <text> | status <thinking|working|waiting|idle> | devices | quit');

  const input = readline.createInterface({ input: process.stdin });
  input.on('line', (line) => {
    const [command, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(' ');
    const run = (name: string, args: Record<string, unknown>) =>
      bot.call(name, args).then((answer) => say(answer.isError ? 'error:' : 'ok:', answer.text), (err: unknown) => say('failed:', err));
    if (command === 'say' && arg) void run('desk_say', { text: arg });
    else if (command === 'status' && arg) void run('desk_status', { state: arg });
    else if (command === 'devices') void run('desk_devices', {});
    else if (command === 'quit') void bot.stop().then(() => process.exit(0));
    else if (command) say('commands: say <text> | status <state> | devices | quit');
  });
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) await main();
