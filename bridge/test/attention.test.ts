// Attention (spec §4.3.1): "waiting" from the bot shows on its devices with one chirp, outlasts the
// spoken question, the old status expiry, a reconnect and a restart of the bridge, and ends with the
// owner's next message (the bot's next turn, or a spoken message), or Clear. Older firmware is sent
// "waiting" as before. The status expiry and the turn gaps are shortened; mock speech, fake devices.
import assert from 'node:assert/strict';
import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { MIC_RATE, tones } from '../src/audio.ts';
import { loadConfig } from '../src/config.ts';
import { type Bridge, startBridge } from '../src/server.ts';
import type { TurnView } from '../src/turns.ts';
import { FakeDevice, type Played } from '../tools/fake-device.ts';
import { FakeGrokBot } from '../tools/fake-grokbot.ts';
import { FakeListenPage } from '../tools/fake-listen-page.ts';

const WEBHOOK_KEY = 'test-webhook-key';
const TIMING = { statusExpiryMs: 1200, turnQuietMs: 800, turnExpiryMs: 1200 };

let dataDir: string;
let bridge: Bridge;
let bot: FakeGrokBot;
let botId: string;
let desk: FakeDevice; // firmware 0.6.3 and later: it lists "attention"
let older: FakeDevice; // firmware 0.6.2, on the same bot
let chirps = 0;

async function call(method: string, url: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${bridge.adminPort}${url}`, {
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

interface OverviewDevice {
  id: string;
  features: string[];
  showing: string | null;
  attention: { since: string } | null;
}

async function overviewDevice(id: string): Promise<OverviewDevice> {
  const { devices } = await admin<{ devices: OverviewDevice[] }>('GET', '/api/overview');
  const device = devices.find((d) => d.id === id);
  assert.ok(device, `${id} is in the overview`);
  return device;
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

async function connect(id: string, options: { key?: string; attention: boolean; board?: string }): Promise<FakeDevice> {
  const device = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id, ...options });
  if (options.key) {
    const config = next(device, 'config');
    await device.connect();
    await config;
    return device;
  }
  const pending = next(device, 'pending');
  await device.connect();
  await pending;
  const config = next(device, 'config');
  await admin('POST', `/api/devices/${id}/approve`, { botId, name: id });
  await config;
  return device;
}

function countChirps(device: FakeDevice): void {
  device.on('played', (p: Played) => {
    if (p.kind === 'tone') chirps++;
  });
}

/** The bot starts waiting for the owner: both devices show it. */
async function startWaiting(): Promise<void> {
  const shown = Promise.all([next(desk, 'show', (s) => s === 'waiting'), next(older, 'show', (s) => s === 'waiting')]);
  const answer = await bot.call('desk_status', { state: 'waiting' });
  assert.equal(answer.isError, false, answer.text);
  await shown;
}

async function startBridgeHere(): Promise<void> {
  bridge = await startBridge({ ...loadConfig({}), dataDir, publicPort: 0, adminPort: 0, logLevel: 'silent' }, { timing: TIMING });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-attention-'));
  await startBridgeHere();
  const { key } = await admin<{ key: string }>('POST', '/api/mcp-key', {});
  bot = new FakeGrokBot({ mcpUrl: `http://127.0.0.1:${bridge.publicPort}/mcp`, mcpKey: key, webhookKey: WEBHOOK_KEY, replyDelayMs: 20 });
  await bot.start();
  ({ id: botId } = await admin<{ id: string }>('POST', '/api/bots', { name: 'Desk Bot', webhookUrl: bot.url, webhookKey: WEBHOOK_KEY }));
  desk = await connect('att-desk', { attention: true });
  older = await connect('old-desk', { attention: false, board: 'waveshare-lcd-1.46' });
  countChirps(desk);
});

beforeEach(async () => {
  // Each test starts with nothing waiting, and past the turn gaps, so its first call starts a new turn.
  await bot.call('desk_status', { state: 'idle' });
  await sleep(TIMING.turnQuietMs + 100);
  chirps = 0;
});

after(async () => {
  desk?.close();
  older?.close();
  await bot?.stop();
  await bridge?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('"waiting" starts attention: the devices show it, one chirp plays, and the overview says since when', async () => {
  assert.ok((await overviewDevice('att-desk')).features.includes('attention'));
  assert.ok(!(await overviewDevice('old-desk')).features.includes('attention'), 'older firmware is sent "waiting" as before');
  const chirp = next<Played>(desk, 'played', (p) => p.kind === 'tone');
  await startWaiting();
  await chirp;
  const shown = await overviewDevice('att-desk');
  assert.equal(shown.showing, 'waiting');
  assert.ok(shown.attention && Date.parse(shown.attention.since) > Date.now() - 10_000);

  // Asked again, it plays nothing more.
  await bot.call('desk_status', { state: 'waiting' });
  await sleep(400);
  assert.equal(chirps, 1);
  const turn = (await admin<{ turns: TurnView[] }>('GET', '/api/turns')).turns[0];
  assert.ok(turn.events.some((e) => 'attention' in e && e.attention === 'started' && e.device === 'att-desk'));
});

test('it outlasts the old status expiry, while "working" still expires', async () => {
  await startWaiting();
  await sleep(TIMING.statusExpiryMs + 600);
  assert.equal(desk.shown, 'waiting');
  assert.ok((await overviewDevice('att-desk')).attention);

  const idle = next(desk, 'show', (s) => s === 'idle', TIMING.statusExpiryMs + 2000);
  await bot.call('desk_status', { state: 'working' });
  assert.equal((await overviewDevice('att-desk')).attention, null, '"working" replaced it');
  await idle; // ... and expired
});

test('the spoken question in the same turn keeps it', async () => {
  await startWaiting();
  const played = next<Played>(desk, 'played', (p) => p.kind === 'speech');
  await bot.call('desk_say', { text: 'Which name do you like?' });
  await played;
  await next(desk, 'show', (s) => s === 'waiting');
  assert.ok((await overviewDevice('att-desk')).attention);
});

test('it outlasts a reconnect of the device', async () => {
  await startWaiting();
  const key = desk.key;
  desk.close();
  await next(desk, 'closed');
  chirps = 0; // the chirp it heard before it went
  desk = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id: 'att-desk', key, attention: true });
  countChirps(desk);
  const shown = next(desk, 'show');
  await desk.connect();
  assert.equal(await shown, 'waiting');
  await sleep(300);
  assert.equal(chirps, 0, 'no chirp again on a reconnect');
});

test("the bot's next turn ends it: a reply after the turn that asked has ended", async () => {
  await startWaiting();
  await sleep(TIMING.turnQuietMs + 100); // the owner answers in the app; the bot replies without "thinking"
  const played = next<Played>(desk, 'played', (p) => p.kind === 'speech');
  await bot.call('desk_say', { text: 'Done, as you asked.' });
  assert.equal((await overviewDevice('att-desk')).attention, null);
  await played;
  await next(desk, 'show', (s) => s === 'idle');
  const turn = (await admin<{ turns: TurnView[] }>('GET', '/api/turns')).turns[0];
  assert.ok(turn.events.some((e) => 'attention' in e && e.attention === 'ended'), 'the new turn says it ended attention');
  assert.equal(turn.checks.thinking_first, 'fail', 'and is flagged for skipping "thinking"');
});

test('a "thinking" for the next message ends it at once', async () => {
  await startWaiting();
  const thinking = next(desk, 'show', (s) => s === 'thinking');
  await bot.call('desk_status', { state: 'thinking' });
  await thinking;
  assert.equal((await overviewDevice('att-desk')).attention, null);
  assert.equal((await overviewDevice('old-desk')).attention, null);
});

test('a spoken message ends it on every device of the bot when the device sends it', async () => {
  await startWaiting();
  const thinking = next(desk, 'show', (s) => s === 'thinking');
  const olderIdle = next(older, 'show', (s) => s === 'idle');
  bot.voice = 'no-reply'; // so that nothing else ends it meanwhile
  try {
    await desk.talk(tones([{ hz: 300, ms: 800 }], MIC_RATE));
    await thinking;
    await olderIdle;
    assert.equal((await overviewDevice('att-desk')).attention, null);
    assert.equal((await overviewDevice('old-desk')).attention, null);
    const voice = (await admin<{ turns: TurnView[] }>('GET', '/api/turns')).turns.find((t) => t.kind === 'voice');
    assert.ok(voice?.events.some((e) => 'attention' in e && e.attention === 'ended'));
  } finally {
    bot.voice = 'good';
    // Answer it, so the device doesn't rest on "thinking" for the voice message in the next tests.
    const played = next<Played>(desk, 'played', (p) => p.kind === 'speech');
    await bot.call('desk_say', { text: 'Answered.', request_id: String(bot.received.at(-1)?.body.request_id) });
    await played;
  }
});

test('Clear on the card ends it on that device', async () => {
  await startWaiting();
  const idle = next(desk, 'show', (s) => s === 'idle');
  const cleared = await admin<{ message: string }>('DELETE', '/api/devices/att-desk/attention');
  assert.match(cleared.message, /no longer shows/);
  await idle;
  assert.equal((await overviewDevice('att-desk')).attention, null);
  assert.ok((await overviewDevice('old-desk')).attention, 'the other device still shows it');
  const { history } = await admin<{ history: Array<{ detail?: string }> }>('GET', '/api/overview');
  assert.match(history[0]?.detail ?? '', /attention cleared/);
  const again = await admin<{ message: string }>('DELETE', '/api/devices/att-desk/attention');
  assert.match(again.message, /wasn't showing/);
});

test('a muted device shows it without a sound', async () => {
  await admin('PATCH', '/api/devices/att-desk', { muted: true });
  try {
    await startWaiting();
    await sleep(500);
    assert.equal(chirps, 0);
  } finally {
    await admin('PATCH', '/api/devices/att-desk', { muted: false });
  }
});

test('a Listen page shows it, and plays the chirp when the speech plays there', async () => {
  const page = new FakeListenPage({ url: `ws://127.0.0.1:${bridge.adminPort}/listen/ws`, origin: `http://127.0.0.1:${bridge.adminPort}` });
  await page.connect();
  await admin('PATCH', '/api/devices/att-desk', { speakOn: 'page' });
  try {
    const ready = next(page, 'status', (s: { role: string }) => s.role === 'here');
    page.listen('att-desk');
    page.start();
    await ready;
    const waiting = next(page, 'show', (s) => s === 'waiting');
    const chirp = next<Played>(page, 'played', (p) => p.kind === 'tone');
    await startWaiting();
    await waiting;
    await chirp;
    assert.equal(chirps, 0, 'not on the device');
  } finally {
    page.close();
    await admin('PATCH', '/api/devices/att-desk', { speakOn: 'device' });
  }
});

test('it outlasts a restart of the bridge', async () => {
  await startWaiting();
  const keys = { desk: desk.key, older: older.key };
  desk.close();
  older.close();
  await bridge.close();
  await startBridgeHere();
  desk = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id: 'att-desk', key: keys.desk, attention: true });
  const shown = next(desk, 'show');
  await desk.connect();
  assert.equal(await shown, 'waiting');
  assert.ok((await overviewDevice('att-desk')).attention);
  older = await connect('old-desk', { key: keys.older, attention: false, board: 'waveshare-lcd-1.46' });
  // The fake bot keeps calling the old address: point it at the new bridge.
  const { key } = await admin<{ key: string }>('POST', '/api/mcp-key', {});
  await bot.stop();
  bot = new FakeGrokBot({ mcpUrl: `http://127.0.0.1:${bridge.publicPort}/mcp`, mcpKey: key, webhookKey: WEBHOOK_KEY, replyDelayMs: 20 });
  await bot.start();
});
