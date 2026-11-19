// Two bots on one bridge (spec §5.5): the first bot keeps the calls that name no bot (the default
// bot), a second bot names itself, voice turns go by their request_id, and data from an older bridge
// with several bots and no default refuses unnamed calls, as before. Fake devices and fake Grok Bots.
import assert from 'node:assert/strict';
import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { MIC_RATE, tones } from '../src/audio.ts';
import { loadConfig } from '../src/config.ts';
import { hashKey, newKey } from '../src/keys.ts';
import { type Bridge, startBridge } from '../src/server.ts';
import type { TurnView } from '../src/turns.ts';
import { FakeDevice, type Played } from '../tools/fake-device.ts';
import { FakeGrokBot } from '../tools/fake-grokbot.ts';

const WEBHOOK_KEY = 'test-webhook-key';

let dataDir: string;
let bridge: Bridge;
let mcpKey: string;
let main: FakeGrokBot; // the first bot: its instructions name no bot
let second: FakeGrokBot; // "Test Bot": its instructions name it
let mainDesk: FakeDevice;
let testDesk: FakeDevice;
const ids = { main: '', test: '' };
const spoken = { main: 0, test: 0 };

async function call(method: string, url: string, body?: unknown, port = bridge.adminPort): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: { 'x-desk-admin': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function admin<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> {
  const { status, json } = await call(method, url, body);
  assert.ok(status < 300, `${method} ${url} failed: ${String(json.error)}`);
  return json as T;
}

function next<T>(emitter: EventEmitter, event: string, check: (value: T) => boolean = () => true, ms = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, listener);
      reject(new Error(`no matching "${event}" within ${ms} ms`));
    }, ms);
    const listener = (value: T) => {
      if (!check(value)) return;
      clearTimeout(timer);
      emitter.off(event, listener);
      resolve(value);
    };
    emitter.on(event, listener);
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function approve(id: string, botId: string, name: string): Promise<FakeDevice> {
  const device = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id, board: 'waveshare-amoled-1.8', attention: true });
  const pending = next(device, 'pending');
  await device.connect();
  await pending;
  const config = next(device, 'config');
  await admin('POST', `/api/devices/${id}/approve`, { botId, name });
  await config;
  return device;
}

async function latestTurn(): Promise<TurnView> {
  const { turns } = await admin<{ turns: TurnView[] }>('GET', '/api/turns');
  assert.ok(turns.length, 'a turn was recorded');
  return turns[0];
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-bots-'));
  bridge = await startBridge({ ...loadConfig({}), dataDir, publicPort: 0, adminPort: 0, logLevel: 'silent' });
  ({ key: mcpKey } = await admin<{ key: string }>('POST', '/api/mcp-key', {}));
  const mcpUrl = `http://127.0.0.1:${bridge.publicPort}/mcp`;
  main = new FakeGrokBot({ mcpUrl, mcpKey, webhookKey: WEBHOOK_KEY, replyDelayMs: 20 });
  second = new FakeGrokBot({ mcpUrl, mcpKey, webhookKey: WEBHOOK_KEY, replyDelayMs: 20, bot: 'Test Bot' });
  await main.start();
  await second.start();
  ({ id: ids.main } = await admin<{ id: string }>('POST', '/api/bots', { name: 'Main Bot', webhookUrl: main.url, webhookKey: WEBHOOK_KEY }));
  mainDesk = await approve('main-desk', ids.main, 'Main desk');
  mainDesk.on('played', (p: Played) => p.kind === 'speech' && spoken.main++);
});

after(async () => {
  mainDesk?.close();
  testDesk?.close();
  await main?.stop();
  await second?.stop();
  await bridge?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('with one bot, a call that names no bot reaches it as the only bot', async () => {
  const played = next<Played>(mainDesk, 'played', (p) => p.kind === 'speech');
  assert.equal((await main.call('desk_say', { text: 'Only me here.' })).isError, false);
  await played;
  const turn = await latestTurn();
  assert.equal(turn.bot, 'Main Bot');
  assert.ok(turn.events.some((e) => 'call' in e && e.via === 'only'));
});

test('adding a second bot keeps the first as the default for calls that name no bot', async () => {
  const added = await admin<{ id: string; message: string }>('POST', '/api/bots', {
    name: 'Test Bot',
    webhookUrl: second.url,
    webhookKey: WEBHOOK_KEY,
  });
  ids.test = added.id;
  assert.match(added.message, /Calls that don't name a bot still go to Main Bot/);
  const overview = await admin<{ defaultBotId: string }>('GET', '/api/overview');
  assert.equal(overview.defaultBotId, ids.main);
  testDesk = await approve('test-desk', ids.test, 'Test desk');
  testDesk.on('played', (p: Played) => p.kind === 'speech' && spoken.test++);
});

test("the first bot's typed replies keep reaching its desk, found as the default bot", async () => {
  const before = { ...spoken };
  const played = next<Played>(mainDesk, 'played', (p) => p.kind === 'speech');
  const answers = await main.turn('quick', 'what time is it');
  assert.ok(answers.every((a) => !a.isError), answers.map((a) => a.text).join(' | '));
  await played;
  await sleep(200);
  assert.deepEqual(spoken, { main: before.main + 1, test: before.test }, 'only the main desk spoke');

  const turn = await latestTurn();
  assert.equal(turn.bot, 'Main Bot');
  assert.deepEqual(turn.devices, ['Main desk']);
  assert.ok(turn.events.filter((e) => 'call' in e).every((e) => 'call' in e && e.via === 'default'));
  assert.match(turn.notes.join(' '), /only as the default bot/);

  const { mcp } = await admin<{ mcp: { calls: Array<{ tool: string; bot?: string; via?: string }> } }>('GET', '/api/overview');
  const say = mcp.calls.find((c) => c.tool === 'desk_say');
  assert.deepEqual([say?.bot, say?.via], ['Main Bot', 'default'], 'Recent calls say where it went');
});

test('a second bot that names itself reaches only its own desk', async () => {
  const before = { ...spoken };
  const played = next<Played>(testDesk, 'played', (p) => p.kind === 'speech');
  const answers = await second.turn('good', 'look something up');
  assert.ok(answers.every((a) => !a.isError), answers.map((a) => a.text).join(' | '));
  await played;
  await sleep(200);
  assert.deepEqual(spoken, { main: before.main, test: before.test + 1 }, 'only the test desk spoke');

  const turn = await latestTurn();
  assert.equal(turn.bot, 'Test Bot');
  assert.ok(turn.events.filter((e) => 'call' in e).every((e) => 'call' in e && e.via === 'bot'));
  assert.equal(turn.checks.thinking_first, 'pass');
  assert.equal(turn.checks.no_errors, 'pass');
});

test("a voice turn on the second bot's desk goes by its request_id", async () => {
  const before = { ...spoken };
  const played = next<Played>(testDesk, 'played', (p) => p.kind === 'speech');
  await testDesk.talk(tones([{ hz: 300, ms: 800 }], MIC_RATE));
  await played;
  await sleep(200);
  assert.deepEqual(spoken, { main: before.main, test: before.test + 1 });
  assert.equal(second.received.at(-1)?.body.bot_name, 'Test Bot');
  assert.equal(main.received.length, 0, 'the first bot got no webhook');

  const turn = await latestTurn();
  assert.equal(turn.kind, 'voice');
  assert.equal(turn.bot, 'Test Bot');
  assert.equal(turn.checks.request_id, 'pass');
  assert.ok(turn.events.filter((e) => 'call' in e).every((e) => 'call' in e && e.via === 'request'));
});

test('with the default set to none, a call that names no bot is refused, as before, and recorded', async () => {
  const refuse = await admin<{ message: string }>('PUT', '/api/default-bot', { botId: '' });
  assert.match(refuse.message, /are refused/);
  const answer = await main.call('desk_say', { text: 'Anyone there?' });
  assert.equal(answer.isError, true);
  assert.match(answer.text, /Several bots use this desk bridge: pass your bot name/);
  const turn = await latestTurn();
  assert.equal(turn.bot, '');
  assert.equal(turn.checks.no_errors, 'fail');

  assert.equal((await call('PUT', '/api/default-bot', { botId: 'nope' })).status, 400);
  await admin('PUT', '/api/default-bot', { botId: ids.main });
});

test('deleting the default bot hands the calls that name no bot to the one left', async () => {
  await admin('DELETE', `/api/bots/${ids.main}`);
  const overview = await admin<{ defaultBotId: string }>('GET', '/api/overview');
  assert.equal(overview.defaultBotId, ids.test);
});

test("an older bridge's data with two bots and no default loads, and refuses calls that name no bot as before", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-old-'));
  const key = newKey();
  const bot = (id: string, name: string) => ({
    id,
    name,
    webhookUrl: '',
    webhookKey: '',
    avatar: { shape: 'blob', color: '#9ca3af' },
    voice: '',
    sendRecent: false,
  });
  // As main's bridge (firmware 0.6.2 era) writes it: no defaultBotId, no attention, no turns.json.
  fs.writeFileSync(
    path.join(dir, 'state.json'),
    JSON.stringify({
      version: 1,
      mcpKeyHash: hashKey(key),
      mcpKeyEnd: key.slice(-4),
      mcpKeyCreatedAt: '2026-11-18T10:00:00.000Z',
      bots: [bot('b1', 'One'), bot('b2', 'Two')],
      devices: [
        {
          id: 'old-desk',
          name: 'Old desk',
          status: 'approved',
          keyHash: hashKey(newKey()),
          botId: 'b1',
          volume: 70,
          muted: false,
          speakOn: 'device',
          timings: { maxListenMs: 60000 },
          firmware: 'desk-display/0.6.2',
          features: ['speaking', 'touch', 'microphone', 'speaker'],
          board: 'waveshare-lcd-1.46',
          firstSeen: '2026-11-18T10:00:00.000Z',
          lastSeen: '2026-11-18T10:00:00.000Z',
        },
      ],
      speech: {},
      history: [{ id: 1, at: '2026-11-18T10:00:00.000Z', kind: 'say', ok: true, botId: 'b1', text: 'Hello.' }],
      nextHistoryId: 2,
    }),
  );
  const old = await startBridge({ ...loadConfig({}), dataDir: dir, publicPort: 0, adminPort: 0, logLevel: 'silent' });
  try {
    const overview = (await call('GET', '/api/overview', undefined, old.adminPort)).json as {
      defaultBotId: string;
      devices: Array<{ id: string; attention: unknown }>;
      history: unknown[];
    };
    assert.equal(overview.defaultBotId, '');
    assert.deepEqual(overview.devices.map((d) => [d.id, d.attention]), [['old-desk', null]]);
    assert.equal(overview.history.length, 1);
    assert.deepEqual((await call('GET', '/api/turns', undefined, old.adminPort)).json, { turns: [], total: 0 });

    const bot = new FakeGrokBot({ mcpUrl: `http://127.0.0.1:${old.publicPort}/mcp`, mcpKey: key, webhookKey: 'x' });
    const answer = await bot.call('desk_status', { state: 'thinking' });
    assert.equal(answer.isError, true);
    assert.match(answer.text, /Several bots use this desk bridge/);
    assert.equal((await bot.call('desk_status', { state: 'thinking', bot: 'One' })).isError, false, 'a named call still works');
  } finally {
    await old.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
