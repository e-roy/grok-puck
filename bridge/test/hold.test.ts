// Holding to talk (spec §4.4): a hold stops the clip playing and drops every clip queued behind it,
// on the device and on its Listen page, so none of it plays later; History says how many. A clip that
// comes while the device is held isn't played either. The offline queue is left alone, and what comes
// after the hold plays. Mock speech, fake devices, a fake Listen page and a fake Grok Bot; nothing
// leaves this computer.
import assert from 'node:assert/strict';
import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { loadConfig } from '../src/config.ts';
import { type Bridge, startBridge } from '../src/server.ts';
import type { HistoryEntry } from '../src/store.ts';
import type { TurnView } from '../src/turns.ts';
import { FakeDevice, type Played } from '../tools/fake-device.ts';
import { FakeGrokBot } from '../tools/fake-grokbot.ts';
import { FakeListenPage } from '../tools/fake-listen-page.ts';

const WEBHOOK_KEY = 'test-webhook-key';
// About ten seconds of mock speech: still playing when the device is held.
const LONG = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');

let dataDir: string;
let bridge: Bridge;
let bot: FakeGrokBot;
let botId: string;
const open: Array<FakeDevice | FakeListenPage> = [];

async function admin<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${bridge.adminPort}${url}`, {
    method,
    headers: { 'x-desk-admin': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  assert.ok(res.status < 300, `${method} ${url} failed: ${String(json.error)}`);
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

/** Counts an event from now on. */
function count(emitter: EventEmitter, event: string): () => number {
  let n = 0;
  emitter.on(event, () => n++);
  return () => n;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fake device, approved with the test bot, that plays clips at their length like a speaker. */
async function approved(id: string): Promise<FakeDevice> {
  const device = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id, speaking: true });
  device.realtime = true;
  open.push(device);
  const pending = next(device, 'pending');
  await device.connect();
  await pending;
  const config = next(device, 'config');
  await admin('POST', `/api/devices/${id}/approve`, { botId, name: id });
  await config;
  return device;
}

/** The same device again after being offline, with its key (not connected yet). */
function reconnect(device: FakeDevice): FakeDevice {
  const back = new FakeDevice({ url: device.url, id: device.id, key: device.key, speaking: true });
  back.realtime = true;
  open.push(back);
  return back;
}

async function online(id: string): Promise<boolean> {
  const { devices } = await admin<{ devices: Array<{ id: string; online: boolean }> }>('GET', '/api/overview');
  return devices.find((d) => d.id === id)?.online ?? false;
}

async function goOffline(device: FakeDevice): Promise<void> {
  const closed = next(device, 'closed');
  device.close();
  await closed;
  for (let i = 0; i < 40 && (await online(device.id)); i++) await sleep(25);
}

async function history(deviceId: string): Promise<HistoryEntry[]> {
  const { history } = await admin<{ history: HistoryEntry[] }>('GET', '/api/overview');
  return history.filter((h) => h.deviceId === deviceId);
}

/** History's line for a hold that dropped clips, once the bridge has handled the hold. */
async function droppedLine(deviceId: string): Promise<HistoryEntry | undefined> {
  for (let i = 0; i < 40; i++) {
    const line = (await history(deviceId)).find((h) => h.detail?.includes('dropped'));
    if (line) return line;
    await sleep(25);
  }
  return undefined;
}

function say(id: string, text: string): Promise<{ message: string }> {
  return admin('POST', `/api/devices/${id}/say`, { text });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-hold-'));
  bridge = await startBridge({ ...loadConfig({}), dataDir, publicPort: 0, adminPort: 0, logLevel: 'silent' });
  const { key } = await admin<{ key: string }>('POST', '/api/mcp-key', {});
  bot = new FakeGrokBot({ mcpUrl: `http://127.0.0.1:${bridge.publicPort}/mcp`, mcpKey: key, webhookKey: WEBHOOK_KEY, replyDelayMs: 20 });
  await bot.start();
  ({ id: botId } = await admin<{ id: string }>('POST', '/api/bots', { name: 'Hold Bot', voice: 'mock', webhookUrl: bot.url, webhookKey: WEBHOOK_KEY }));
});

// Each test's devices and pages go when it ends; then they are forgotten, so the bot's calls in the
// next test reach only that test's devices.
afterEach(async () => {
  for (const item of open.splice(0)) item.close();
  const { devices } = await admin<{ devices: Array<{ id: string }> }>('GET', '/api/overview');
  for (const d of devices) await admin('DELETE', `/api/devices/${d.id}`);
});

after(async () => {
  await bot?.stop();
  await bridge?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a hold stops the clip playing and drops the clips queued behind it: none of them plays, then or later', async () => {
  const device = await approved('hold-q1');
  const starts = count(device, 'start');
  const first = next(device, 'start');
  for (let i = 0; i < 3; i++) assert.match((await say('hold-q1', LONG)).message, /^Speaking on hold-q1\.$/);
  await first;

  device.startListening();
  const line = await droppedLine('hold-q1');
  assert.equal(line?.detail, '2 queued clips dropped, not spoken: the owner held hold-q1 to talk.');
  assert.equal(line?.kind, 'say');
  assert.equal(line?.ok, true);
  assert.equal(line?.botId, botId, "with the device's bot, like the lines of what it said");
  await sleep(600);
  assert.equal(starts(), 1, 'nothing started while held');

  device.cancelListening(); // let go with too little voice: nothing is sent
  await sleep(800);
  assert.equal(starts(), 1, 'nothing started after letting go');
  const said = (await history('hold-q1')).filter((h) => h.kind === 'say' && h.text === LONG);
  assert.equal(said.length, 3, 'the text of each stays in History');
});

test('on a ready Listen page too: the clip there stops and the one queued behind it never plays', async () => {
  const device = await approved('hold-p1');
  await admin('PATCH', '/api/devices/hold-p1', { speakOn: 'page' });
  const page = new FakeListenPage({ url: `ws://127.0.0.1:${bridge.adminPort}/listen/ws`, origin: `http://127.0.0.1:${bridge.adminPort}` });
  open.push(page);
  await page.connect();
  const picked = next(page, 'status', (s: { device: string | null }) => s.device === 'hold-p1');
  page.listen('hold-p1');
  await picked;
  const ready = next(page, 'status', (s: { ready: boolean }) => s.ready);
  page.start();
  await ready;

  const onPage = count(page, 'start');
  const onDevice = count(device, 'start');
  const first = next(page, 'start');
  for (let i = 0; i < 2; i++) assert.match((await say('hold-p1', LONG)).message, /^Speaking on the Listen page for hold-p1\.$/);
  await first;
  const stopped = next(page, 'stopped');
  device.startListening();
  await stopped;
  assert.equal((await droppedLine('hold-p1'))?.detail, '1 queued clip dropped, not spoken: the owner held hold-p1 to talk.');
  device.cancelListening();
  await sleep(800);
  assert.equal(onPage(), 1, 'only the clip that was playing started on the page');
  assert.equal(onDevice(), 0, 'and none on the device');

  // What comes after the hold plays there.
  const played = next<Played>(page, 'played');
  await say('hold-p1', 'After the hold.');
  assert.equal((await played).kind, 'speech');
});

test('a clip that comes while the device is held is not played; one that comes after it is', async () => {
  const device = await approved('hold-w1');
  const starts = count(device, 'start');
  device.startListening();
  await sleep(100);
  assert.equal((await say('hold-w1', 'Are you still there?')).message, 'Not spoken on hold-w1: the owner is holding it to talk.');
  await sleep(500);
  assert.equal(starts(), 0);
  device.cancelListening();
  await sleep(100);

  const played = next<Played>(device, 'played');
  assert.equal((await say('hold-w1', 'Now you can hear me.')).message, 'Speaking on hold-w1.');
  assert.equal((await played).kind, 'speech');
  assert.equal(starts(), 1);
  assert.equal(await droppedLine('hold-w1'), undefined, 'nothing was queued when the hold began: no line for it');
});

test("a hold leaves the offline queue alone: what was kept for a device while it was offline plays when it's back", async () => {
  const device = await approved('hold-o1');
  const first = next(device, 'start');
  for (let i = 0; i < 2; i++) await say('hold-o1', LONG);
  await first;
  device.startListening(); // drops the second clip
  await droppedLine('hold-o1');
  await goOffline(device); // it drops off the network while held

  assert.match((await say('hold-o1', 'Kept for later.')).message, /^Saved for hold-o1 \(offline\)/);
  const back = reconnect(device);
  const starts = count(back, 'start');
  const played = next<Played>(back, 'played');
  await back.connect();
  const clip = await played;
  assert.equal(clip.kind, 'speech');
  await sleep(800);
  assert.equal(starts(), 1, 'only what was kept: the dropped clip stays dropped');
  assert.ok(clip.pcm.length < 24_000 * 2 * 5, `the short kept clip, not the long dropped one (${clip.pcm.length} bytes)`);
});

test("the bot's own calls: a held device isn't spoken on, another device's offline queue is kept, and the turn records both", async () => {
  const held = await approved('hold-b1');
  const away = await approved('hold-b2');
  await goOffline(away);
  held.startListening();
  await sleep(100);

  const answer = await bot.call('desk_say', { text: 'Two places, one held.' });
  assert.equal(answer.isError, false, answer.text);
  assert.match(answer.text, /Saved for hold-b2 \(offline\)/);
  assert.match(answer.text, /Not spoken on hold-b1: the owner is holding it to talk\./);
  held.cancelListening();

  const back = reconnect(away);
  const played = next<Played>(back, 'played');
  await back.connect();
  assert.equal((await played).kind, 'speech', 'the other device speaks what was kept for it');

  const turn = (await admin<{ turns: TurnView[] }>('GET', '/api/turns')).turns[0];
  const speech = turn.events.flatMap((e) => ('speech' in e ? [`${e.device}: ${e.speech}`] : []));
  assert.ok(speech.includes('hold-b1: dropped'), speech.join(', '));
  assert.ok(speech.includes('hold-b2: kept'), speech.join(', '));
});
