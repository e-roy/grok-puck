// The MCP server Grok Bot calls: Streamable HTTP, stateless (a fresh server per request), JSON answers,
// guarded by the bridge's MCP key in an `Authorization: Bearer` header.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { BOT_STATES, type Desk, type Outcome } from './desk.ts';
import { bearer, keyMatches } from './keys.ts';
import type { Store } from './store.ts';

export const VERSION = '0.1.0';

const INSTRUCTIONS =
  "These tools drive a small display on the owner's desk that shows this bot's avatar and speaks its replies. " +
  'Call desk_status as you work, and desk_say with every reply you write to the owner. ' +
  'Messages the owner speaks to the desk arrive through a routine webhook with a request_id: pass it back to desk_say.';

/** What recent MCP callers looked like, for the admin page: no secrets, no argument values. */
export interface McpCall {
  at: string;
  userAgent: string;
  methods: string[];
  client: string;
  tool: string;
  argumentNames: string[];
  headerNames: string[];
}

export class McpActivity {
  readonly calls: McpCall[] = [];

  record(req: FastifyRequest): void {
    const messages = (Array.isArray(req.body) ? req.body : [req.body]) as Array<{ method?: unknown; params?: unknown }>;
    const params = (m: { params?: unknown }) => (m.params ?? {}) as Record<string, unknown>;
    const init = messages.find((m) => m?.method === 'initialize');
    const info = init ? (params(init).clientInfo as { name?: unknown; version?: unknown } | undefined) : undefined;
    const call = messages.find((m) => m?.method === 'tools/call');
    const args = call ? params(call).arguments : undefined;
    this.calls.unshift({
      at: new Date().toISOString(),
      userAgent: String(req.headers['user-agent'] ?? ''),
      methods: messages.map((m) => String(m?.method ?? '?')),
      client: info ? `${String(info.name ?? '?')} ${String(info.version ?? '')}`.trim() : '',
      tool: call ? String(params(call).name ?? '') : '',
      argumentNames: args && typeof args === 'object' ? Object.keys(args) : [],
      headerNames: Object.keys(req.headers).sort(),
    });
    this.calls.length = Math.min(this.calls.length, 30);
  }
}

export async function handleMcp(
  req: FastifyRequest,
  reply: FastifyReply,
  ctx: { store: Store; desk: Desk; activity: McpActivity },
): Promise<void> {
  const keyHash = ctx.store.state.mcpKeyHash;
  if (!keyHash) {
    await reply.code(503).send({ error: 'The MCP key has not been created yet: admin page → MCP.' });
    return;
  }
  if (!keyMatches(bearer(req.headers.authorization), keyHash)) {
    await reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'unauthorized' });
    return;
  }
  if (req.method !== 'POST') {
    // Stateless server: no server-to-client stream and no sessions to delete.
    await reply.code(405).header('allow', 'POST').send({ error: 'method not allowed' });
    return;
  }
  ctx.activity.record(req);
  const server = buildServer(ctx.desk);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  reply.hijack();
  reply.raw.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  } catch (err) {
    req.log.error({ err }, 'MCP request failed');
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { 'content-type': 'application/json' });
      reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null }));
    }
  }
}

function buildServer(desk: Desk): McpServer {
  const server = new McpServer({ name: 'desk-bridge', version: VERSION }, { instructions: INSTRUCTIONS });
  const target = {
    request_id: z
      .string()
      .max(100)
      .optional()
      .describe('The request_id of the desk message you are answering, if any. It sends the answer to the device that asked.'),
    device: z
      .string()
      .max(64)
      .optional()
      .describe('Name or id of one desk device. Leave it out to reach every device attached to your bot.'),
    bot: z
      .string()
      .max(100)
      .optional()
      .describe('Your bot name as set up on the desk bridge. Only needed when several bots share the bridge.'),
  };

  server.registerTool(
    'desk_say',
    {
      title: 'Speak on the desk display',
      description:
        "Speak text aloud on the owner's desk display, with the bot's avatar animating. Call it with every reply you " +
        'write to the owner, passing the same text you wrote; code blocks and links are skipped when spoken. ' +
        'If the message you are answering came from the desk, pass its request_id.',
      inputSchema: {
        text: z.string().min(1).max(20_000).describe('The reply, exactly as you wrote it.'),
        ...target,
      },
    },
    async (args) => result(desk.say(args.text, { requestId: args.request_id, device: args.device, bot: args.bot })),
  );

  server.registerTool(
    'desk_status',
    {
      title: 'Show your status on the desk display',
      description:
        "Show what you are doing on the owner's desk display: 'thinking' when you start on a message, 'working' while " +
        "you use tools or the browser, 'waiting' when you need the owner's approval or an answer, 'idle' when you are " +
        'done without saying anything.',
      inputSchema: { state: z.enum(BOT_STATES), ...target },
    },
    async (args) => result(desk.status(args.state, { requestId: args.request_id, device: args.device, bot: args.bot })),
  );

  server.registerTool(
    'desk_devices',
    {
      title: 'List the desk displays',
      description: 'List the desk displays on this bridge: name, id, whether online, what each shows and which bot it belongs to.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => result(desk.devicesSummary()),
  );

  return server;
}

function result(outcome: Outcome) {
  return { content: [{ type: 'text' as const, text: outcome.message }], isError: !outcome.ok };
}
