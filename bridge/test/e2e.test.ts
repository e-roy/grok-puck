// The whole loop on this computer: bridge, fake device and fake Grok Bot, with mock speech.
import assert from 'node:assert/strict';
import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { MIC_RATE, tones } from '../src/audio.ts';
import { loadConfig } from '../src/config.ts';
import { type Bridge, startBridge } from '../src/server.ts';
import { FakeDevice, type Played } from '../tools/fake-device.ts';
import { FakeGrokBot } from '../tools/fake-grokbot.ts';

const WEBHOOK_KEY = 'test-webhook-key';

let dataDir: string;
let bridge: Bridge;
let bot: FakeGrokBot;
let device: FakeDevice;
let botId: string;

async function admin<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${bridge.adminPort}${url}`, {
    method,
    headers: { 'x-desk-admin': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  assert.ok(res.ok, `${method} ${url} failed: ${json.error}`);
  return json;
}

/** The next event that passes `check`, or a failure after `ms`. */
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

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-bridge-'));
  bridge = await startBridge({ ...loadConfig({}), dataDir, publicPort: 0, adminPort: 0, logLevel: 'silent' });
  const { key } = await admin<{ key: string }>('POST', '/api/mcp-key', {});
  bot = new FakeGrokBot({ mcpUrl: `http://127.0.0.1:${bridge.publicPort}/mcp`, mcpKey: key, webhookKey: WEBHOOK_KEY, replyDelayMs: 50 });
  await bot.start();
  ({ id: botId } = await admin<{ id: string }>('POST', '/api/bots', {
    name: 'Desk Bot',
    webhookUrl: bot.url,
    webhookKey: WEBHOOK_KEY,
    avatar: { shape: 'teardrop', color: '#f59e0b' },
    voice: 'mock',
  }));
});

after(async () => {
  device?.close();
  await bot?.stop();
  await bridge?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a new device waits for approval, then gets its key and its bot', async () => {
  device = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id: 'test-desk-01' });
  const pending = next(device, 'pending');
  await device.connect();
  await pending;
  const overview = await admin<{ devices: Array<{ id: string; status: string; waiting: boolean }> }>('GET', '/api/overview');
  assert.deepEqual(
    overview.devices.map((d) => [d.id, d.status, d.waiting]),
    [['test-desk-01', 'pending', true]],
  );

  const welcome = next<string>(device, 'welcome');
  const config = next<{ bot: { name: string; avatar: { shape: string } } | null }>(device, 'config');
  await admin('POST', '/api/devices/test-desk-01/approve', { botId, name: 'Desk' });
  assert.ok((await welcome).length > 20);
  assert.deepEqual((await config).bot, { name: 'Desk Bot', avatar: { shape: 'teardrop', color: '#f59e0b' } });
});

test('a spoken message goes to the bot, and its reply is spoken on the device', async () => {
  const thinking = next(device, 'show', (s) => s === 'thinking');
  const working = next(device, 'show', (s) => s === 'working');
  const speech = next<Played>(device, 'played', (p) => p.kind === 'speech');
  await device.talk(tones([{ hz: 300, ms: 800 }], MIC_RATE));
  await thinking;
  await working;
  const played = await speech;
  assert.ok(played.pcm.length > 10_000, 'reply audio arrived');
  assert.equal(played.sampleRate, 24_000);
  await next(device, 'show', (s) => s === 'idle');

  const webhook = bot.received.at(-1);
  assert.equal(webhook?.authorization, `Bearer ${WEBHOOK_KEY}`);
  assert.equal(webhook?.body.text, 'Hello from the desk.'); // the mock STT's text
  assert.equal(webhook?.body.device_name, 'Desk');
  assert.equal(webhook?.body.bot_name, 'Desk Bot');

  const { history } = await admin<{ history: Array<{ kind: string; ok: boolean; timings?: Record<string, number> }> }>('GET', '/api/overview');
  const voice = history.find((h) => h.kind === 'voice');
  assert.ok(voice?.ok && voice.timings?.stt !== undefined && voice.timings.webhook !== undefined);
  assert.ok(history.find((h) => h.kind === 'say')?.timings?.reply !== undefined, 'reply time recorded');
});

test('asking the same thing again gets its answer spoken again', async () => {
  // The previous test's answer had the same words a moment ago; a new question still gets a reply.
  const speech = next<Played>(device, 'played', (p) => p.kind === 'speech');
  await device.talk(tones([{ hz: 300, ms: 800 }], MIC_RATE));
  await speech;
  const { history } = await admin<{ history: Array<{ kind: string; detail?: string }> }>('GET', '/api/overview');
  assert.doesNotMatch(history.find((h) => h.kind === 'say')?.detail ?? '', /Already spoken/);
});

test('the bot can speak and show its status on its own', async () => {
  const speech = next<Played>(device, 'played', (p) => p.kind === 'speech');
  const said = await bot.call('desk_say', { text: '**Reminder:** stand up and stretch.' });
  assert.equal(said.isError, false, said.text);
  assert.match(said.text, /Speaking on Desk/);
  await speech;

  const waiting = next(device, 'show', (s) => s === 'waiting');
  assert.equal((await bot.call('desk_status', { state: 'waiting' })).isError, false);
  await waiting;

  const devices = await bot.call('desk_devices', {});
  assert.match(devices.text, /Desk \(id test-desk-01\): online, showing waiting; bot: Desk Bot/);
});

test('"Speak it" in the admin page speaks the same text again when asked again', async () => {
  for (let i = 0; i < 2; i++) {
    const speech = next<Played>(device, 'played', (p) => p.kind === 'speech');
    const said = await admin<{ message: string }>('POST', '/api/devices/test-desk-01/say', { text: 'Testing, one two.' });
    assert.match(said.message, /Speaking on Desk/);
    await speech;
  }
});

test('"Speak it" on a device without a bot says why nothing is spoken', async () => {
  const spare = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id: 'test-desk-02' });
  const pending = next(spare, 'pending');
  await spare.connect();
  await pending;
  const config = next(spare, 'config');
  await admin('POST', '/api/devices/test-desk-02/approve', { name: 'Spare' });
  await config;
  // A real speech service needs the bot's voice; the mock one doesn't. Nothing is asked of this URL.
  await admin('PUT', '/api/speech', { tts: { provider: 'openai', baseUrl: 'http://127.0.0.1:9/v1' } });
  try {
    const shown = next(spare, 'show', (s) => s === 'error');
    const res = await fetch(`http://127.0.0.1:${bridge.adminPort}/api/devices/test-desk-02/say`, {
      method: 'POST',
      headers: { 'x-desk-admin': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello?' }),
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /Spare has no bot yet/);
    await shown;

    // A new bot is chosen for the devices that have none (and only those).
    const config = next<{ bot: { name: string } | null }>(spare, 'config', (c) => c.bot?.name === 'Spare Bot');
    const added = await admin<{ id: string; message: string }>('POST', '/api/bots', { name: 'Spare Bot' });
    assert.match(added.message, /Spare Bot added and chosen for Spare:/);
    await config;
    await admin('DELETE', `/api/bots/${added.id}`);
  } finally {
    await admin('PUT', '/api/speech', { tts: { provider: 'mock' } });
    spare.close();
    await admin('DELETE', '/api/devices/test-desk-02');
  }
});

test('the admin page can tell an online device to forget its Wi-Fi', async () => {
  const told = next(device, 'forget-wifi');
  await admin('POST', '/api/devices/test-desk-01/forget-wifi', {});
  await told;
});

test('the MCP endpoint refuses a wrong key', async () => {
  const res = await fetch(`http://127.0.0.1:${bridge.publicPort}/mcp`, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(res.status, 401);
});

test('the admin API refuses changes without its header', async () => {
  const res = await fetch(`http://127.0.0.1:${bridge.adminPort}/api/mcp-key`, { method: 'POST' });
  assert.equal(res.status, 403);
});

test('an approved device reconnects with its key, and a wrong key is refused', async () => {
  const key = device.key;
  device.close();
  await next(device, 'closed');

  device = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id: 'test-desk-01', key });
  const config = next(device, 'config');
  await device.connect();
  await config;

  const stranger = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id: 'test-desk-01', key: 'not-the-key' });
  const closed = next<number>(stranger, 'closed');
  await stranger.connect();
  assert.equal(await closed, 4001);
});
