// The Listen page (spec §5.10): Speak on, where each clip plays, several pages for one device, stopping
// from either side, Stop listening, mute, the device's "speaking" while a page plays, and "listening"
// on the pages while the device is held. Mock speech, fake devices and fake Listen pages; nothing
// leaves this computer.
import assert from 'node:assert/strict';
import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { MIC_RATE, tones } from '../src/audio.ts';
import { loadConfig } from '../src/config.ts';
import { type Bridge, startBridge } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { FakeDevice, type Played } from '../tools/fake-device.ts';
import { FakeListenPage } from '../tools/fake-listen-page.ts';

interface OverviewDevice {
  id: string;
  speakOn: string;
  features: string[];
  online: boolean;
  showing: string | null;
  speaking: string | null;
  listen: { open: number; ready: boolean };
}

let dataDir: string;
let bridge: Bridge;
let botId: string;
const open: Array<FakeDevice | FakeListenPage> = [];
// About ten seconds of mock speech: long enough to stop it halfway.
const LONG = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');

async function call(method: string, url: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${bridge.adminPort}${url}`, {
    method,
    headers: { 'x-desk-admin': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function admin(method: string, url: string, body?: unknown): Promise<Record<string, unknown>> {
  const { status, json } = await call(method, url, body);
  assert.ok(status < 300, `${method} ${url} failed: ${String(json.error)}`);
  return json;
}

async function overviewDevice(id: string): Promise<OverviewDevice> {
  const { devices } = (await admin('GET', '/api/overview')) as unknown as { devices: OverviewDevice[] };
  const device = devices.find((d) => d.id === id);
  assert.ok(device, `${id} is in the overview`);
  return device;
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

/** A fake device, approved with the test bot. Acts like firmware 0.6.1 unless told otherwise. */
async function approved(id: string, options: { speaking?: boolean; networks?: string[]; bot?: string } = {}): Promise<FakeDevice> {
  const device = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id, speaking: options.speaking ?? true, networks: options.networks });
  open.push(device);
  const pending = next(device, 'pending');
  await device.connect();
  await pending;
  const config = next(device, 'config');
  await admin('POST', `/api/devices/${id}/approve`, { botId: options.bot ?? botId, name: id });
  await config;
  return device;
}

async function goOffline(device: FakeDevice): Promise<void> {
  const closed = next(device, 'closed');
  device.close();
  await closed;
  for (let i = 0; i < 40 && (await overviewDevice(device.id)).online; i++) await sleep(25);
}

/** A Listen page for this device, as a browser tab: connected, and started unless `start` is false. */
async function listenPage(device: string | null, start = true): Promise<FakeListenPage> {
  const page = new FakeListenPage({ url: `ws://127.0.0.1:${bridge.adminPort}/listen/ws`, origin: `http://127.0.0.1:${bridge.adminPort}` });
  open.push(page);
  await page.connect();
  const picked = next(page, 'status', (s: { device: string | null }) => s.device === device);
  page.listen(device);
  await picked;
  if (start) {
    const ready = next(page, 'status', (s: { ready: boolean }) => s.ready);
    page.start();
    await ready;
  }
  return page;
}

function say(id: string, text = 'Where am I heard?'): Promise<Record<string, unknown>> {
  return admin('POST', `/api/devices/${id}/say`, { text });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-listen-'));
  bridge = await startBridge({ ...loadConfig({}), dataDir, publicPort: 0, adminPort: 0, logLevel: 'silent' });
  ({ id: botId } = (await admin('POST', '/api/bots', { name: 'Desk Bot', voice: 'mock', avatar: { shape: 'hex', color: '#22c55e' } })) as { id: string });
});

// Each test's devices and pages go when it ends (the bridge allows 20 Listen pages at once).
afterEach(() => {
  for (const item of open.splice(0)) item.close();
});

after(async () => {
  await bridge?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Speak on is kept per device: the device by default, and nothing but device, page or both', async () => {
  await approved('setting-01');
  const fresh = await overviewDevice('setting-01');
  assert.equal(fresh.speakOn, 'device');
  assert.deepEqual(fresh.listen, { open: 0, ready: false });
  assert.equal(fresh.speaking, null);
  assert.deepEqual(fresh.features, ['speaking'], 'what its firmware said it can do');

  for (const speakOn of ['page', 'both', 'device']) {
    await admin('PATCH', '/api/devices/setting-01', { speakOn });
    assert.equal((await overviewDevice('setting-01')).speakOn, speakOn);
  }
  const wrong = await call('PATCH', '/api/devices/setting-01', { speakOn: 'speaker' });
  assert.equal(wrong.status, 400);
  assert.match(String(wrong.json.error), /speakOn/);
});

test('a data file from before Speak on loads with Speak on set to the device', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-old-'));
  try {
    const old = { id: 'old', name: 'Old', status: 'approved', keyHash: '', botId: '', volume: 70, muted: false, timings: {}, firmware: 'x', firstSeen: '', lastSeen: '' };
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 1, devices: [old] }));
    const device = new Store(dir).device('old');
    assert.equal(device?.speakOn, 'device');
    assert.deepEqual(device?.features, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Each row of the routing table (spec §5.10), on its own device. "kept": nowhere to speak now, so it
// waits for the device, or (with the Listen page in Speak on) for a page, whichever comes first.
const ROWS = [
  { speakOn: 'device', ready: true, online: true, plays: 'device' },
  { speakOn: 'device', ready: true, online: false, plays: 'kept' },
  { speakOn: 'device', ready: false, online: true, plays: 'device' },
  { speakOn: 'device', ready: false, online: false, plays: 'kept' },
  { speakOn: 'page', ready: true, online: true, plays: 'page' },
  { speakOn: 'page', ready: true, online: false, plays: 'page' },
  { speakOn: 'page', ready: false, online: true, plays: 'device' },
  { speakOn: 'page', ready: false, online: false, plays: 'kept' },
  { speakOn: 'both', ready: true, online: true, plays: 'both' },
  { speakOn: 'both', ready: true, online: false, plays: 'page' },
  { speakOn: 'both', ready: false, online: true, plays: 'device' },
  { speakOn: 'both', ready: false, online: false, plays: 'kept' },
] as const;

ROWS.forEach((row, i) => {
  const name = `routing: Speak on ${row.speakOn}, ${row.ready ? 'a Listen page ready' : 'no Listen page ready'}, the device ${row.online ? 'online' : 'offline'} → ${row.plays}`;
  test(name, async () => {
    const id = `row-${i + 1}`;
    const device = await approved(id);
    await admin('PATCH', `/api/devices/${id}`, { speakOn: row.speakOn });
    const page = await listenPage(id, row.ready); // open either way; ready only after Start listening
    if (!row.online) await goOffline(device);
    const onDevice = count(device, 'played');
    const onPage = count(page, 'played');

    if (row.plays === 'kept') {
      const { message } = await say(id);
      assert.match(String(message), new RegExp(`Saved for ${id} \\(offline\\)`));
      await sleep(300);
      assert.equal(onPage(), 0, 'nothing played on the page');
      if (row.speakOn === 'device') {
        // Nothing lost: the device speaks it when it is back (and the page, ready or not, doesn't).
        const back = new FakeDevice({ url: device.url, id, key: device.key, speaking: true });
        open.push(back);
        const played = next<Played>(back, 'played');
        await back.connect();
        assert.equal((await played).kind, 'speech');
        assert.equal(onPage(), 0);
      } else {
        // Nothing lost: the page plays it once it is started.
        const played = next<Played>(page, 'played');
        page.start();
        assert.equal((await played).kind, 'speech');
      }
      return;
    }

    const spoke = next(page, 'show', (s) => s === 'speaking');
    const { message } = await say(id);
    const expected = { device: `Speaking on ${id}\\.`, page: `Speaking on the Listen page for ${id}\\.`, both: `Speaking on ${id} and its Listen page\\.` }[row.plays];
    assert.match(String(message), new RegExp(expected), 'the answer (and the history) says where');
    await spoke;
    await next(page, 'show', (s) => s === 'idle'); // the clip has ended everywhere
    assert.equal(onDevice(), row.plays === 'page' ? 0 : 1, 'played on the device');
    assert.equal(onPage(), row.plays === 'device' ? 0 : 1, 'played on the page');
  });
});

test('a muted device plays nowhere, and muting stops what is playing on the page', async () => {
  const device = await approved('mute-01');
  await admin('PATCH', '/api/devices/mute-01', { speakOn: 'both' });
  const page = await listenPage('mute-01');
  page.autoAck = false;
  const started = next(page, 'start');
  await say('mute-01', LONG);
  await started;
  const stopped = next(page, 'stopped');
  const told = next(page, 'status', (s: { devices: Array<{ id: string; muted: boolean }> }) => s.devices.some((d) => d.id === 'mute-01' && d.muted));
  await admin('PATCH', '/api/devices/mute-01', { muted: true });
  await stopped;
  await told;

  const onDevice = count(device, 'played');
  const onPage = count(page, 'start');
  const { message } = await say('mute-01', 'Shh.');
  assert.match(String(message), /mute-01 is muted/);
  await sleep(500);
  assert.equal(onDevice() + onPage(), 0, 'nothing anywhere');
  await admin('PATCH', '/api/devices/mute-01', { muted: false });
});

test('a page that has not pressed Start listening is not ready: the device speaks', async () => {
  const device = await approved('notready-01');
  await admin('PATCH', '/api/devices/notready-01', { speakOn: 'page' });
  const page = await listenPage('notready-01', false);
  assert.equal(page.status?.role, 'off');
  assert.deepEqual((await overviewDevice('notready-01')).listen, { open: 1, ready: false });

  const onPage = count(page, 'start');
  const played = next<Played>(device, 'played');
  const { message } = await say('notready-01');
  assert.match(String(message), /Speaking on notready-01\./);
  await played;
  assert.equal(onPage(), 0);

  const ready = next(page, 'status', (s: { role: string }) => s.role === 'here');
  page.start();
  await ready;
  assert.deepEqual((await overviewDevice('notready-01')).listen, { open: 1, ready: true });
});

test('of two pages for one device, the one started last plays; the other plays elsewhere, then takes over', async () => {
  await approved('two-01');
  await admin('PATCH', '/api/devices/two-01', { speakOn: 'page' });
  const first = await listenPage('two-01');
  assert.equal(first.status?.role, 'here');
  const elsewhere = next(first, 'status', (s: { role: string }) => s.role === 'elsewhere');
  const second = await listenPage('two-01');
  assert.equal(second.status?.role, 'here');
  await elsewhere;
  assert.deepEqual((await overviewDevice('two-01')).listen, { open: 2, ready: true });

  const onFirst = count(first, 'start');
  const played = next<Played>(second, 'played');
  await say('two-01');
  await played;
  assert.equal(onFirst(), 0, 'the page started first plays nothing');

  // The last one closes: the other one is still ready, so it plays from now on.
  const here = next(first, 'status', (s: { role: string }) => s.role === 'here');
  second.close();
  await here;
  const again = next<Played>(first, 'played');
  await say('two-01');
  await again;
});

test('a page that reconnects does not take over from a page started after it', async () => {
  await approved('rejoin-01');
  await admin('PATCH', '/api/devices/rejoin-01', { speakOn: 'page' });
  const first = await listenPage('rejoin-01');
  const second = await listenPage('rejoin-01');
  first.close();
  await next(first, 'closed');
  // The first tab again, after a dropped connection: still started, so ready, but not first in line.
  const rejoined = new FakeListenPage({ url: first.url, origin: `http://127.0.0.1:${bridge.adminPort}` });
  open.push(rejoined);
  await rejoined.connect();
  const status = next<{ device: string | null; role: string }>(rejoined, 'status', (s) => s.device === 'rejoin-01');
  rejoined.listen('rejoin-01', true);
  assert.equal((await status).role, 'elsewhere');
  assert.equal(second.status?.role, 'here');
});

test('the device shows "speaking" while the page plays, then idle once the page has played it', async () => {
  const device = await approved('speak-01');
  await admin('PATCH', '/api/devices/speak-01', { speakOn: 'page' });
  const page = await listenPage('speak-01');
  page.autoAck = false; // the page holds its `played` answer, as if still playing
  const speaking = next(device, 'show', (s) => s === 'speaking');
  const onDevice = count(device, 'played');
  await say('speak-01', 'Hello there');
  await speaking;
  await sleep(700); // all of it has arrived; the page is "still playing"
  assert.equal(device.shown, 'speaking');
  const seen = await overviewDevice('speak-01');
  assert.equal(seen.speaking, 'page');
  assert.equal(seen.showing, 'speaking');

  const idle = next(device, 'show', (s) => s === 'idle');
  page.ack();
  await idle;
  assert.equal(onDevice(), 0, 'no audio on the device');
  assert.equal((await overviewDevice('speak-01')).speaking, null);
});

test('older firmware is never asked to show "speaking": it keeps its resting state while the page plays', async () => {
  const device = await approved('old-fw-01', { speaking: false, networks: ['Home Wi-Fi'] }); // like firmware 0.6.0
  assert.deepEqual((await overviewDevice('old-fw-01')).features, []);
  await admin('PATCH', '/api/devices/old-fw-01', { speakOn: 'page' });
  const page = await listenPage('old-fw-01');
  const played = next<Played>(page, 'played');
  await say('old-fw-01');
  await played;
  await next(page, 'show', (s) => s === 'idle');
  assert.ok(!device.asked.includes('speaking'), `asked for: ${device.asked.join(', ')}`);
  assert.equal(device.shown, 'idle');
});

test('a tap on the device stops the speech playing on the page', async () => {
  const device = await approved('tap-01');
  await admin('PATCH', '/api/devices/tap-01', { speakOn: 'page' });
  const page = await listenPage('tap-01');
  const started = next(page, 'start');
  const speaking = next(device, 'show', (s) => s === 'speaking');
  await say('tap-01', LONG);
  await started;
  await speaking;
  const stopped = next(page, 'stopped');
  const idle = next(device, 'show', (s) => s === 'idle');
  device.stopSpeech(); // what the firmware sends on a tap while it shows "speaking"
  await stopped;
  await idle;
});

test('holding the device to talk stops the speech playing on the page', async () => {
  const device = await approved('hold-01');
  await admin('PATCH', '/api/devices/hold-01', { speakOn: 'page' });
  const page = await listenPage('hold-01');
  const started = next(page, 'start');
  await say('hold-01', LONG);
  await started;
  const stopped = next(page, 'stopped');
  await device.talk(tones([{ hz: 300, ms: 50 }], MIC_RATE)); // too short to send to the bot
  await stopped;
});

test('while the owner holds the device, its pages and the admin page show "listening"; a cancel goes back to what they showed', async () => {
  const device = await approved('held-01');
  const page = await listenPage('held-01', false); // open is enough: it shows what the device shows
  const working = next(page, 'show', (s) => s === 'working');
  await admin('POST', '/api/devices/held-01/show', { state: 'working' });
  await working;

  const listening = next(page, 'show', (s) => s === 'listening');
  device.startListening();
  await listening;
  assert.equal((await overviewDevice('held-01')).showing, 'listening');
  await device.hear(tones([{ hz: 300, ms: 500 }], MIC_RATE));

  const back = next(page, 'show', (s) => s === 'working');
  device.cancelListening(); // too little voice: nothing is sent
  await back;
  assert.equal((await overviewDevice('held-01')).showing, 'working');
  assert.ok(!(device.asked as string[]).includes('listening'), `the device was asked for: ${device.asked.join(', ')}`);
});

test('a hold too short to send: the pages go back to what they showed, and the device is never told "listening"', async () => {
  const device = await approved('held-02');
  const page = await listenPage('held-02', false);
  const waiting = next(page, 'show', (s) => s === 'waiting');
  await admin('POST', '/api/devices/held-02/show', { state: 'waiting' });
  await waiting;
  const listening = next(page, 'show', (s) => s === 'listening');
  const back = next(page, 'show', (s) => s === 'waiting');
  await device.talk(tones([{ hz: 300, ms: 50 }], MIC_RATE)); // sent, but too short for the bot
  await listening;
  await back;
  assert.deepEqual(page.asked.slice(-2), ['listening', 'waiting']);
  assert.equal(device.shown, 'waiting', 'told again what to show');
  assert.ok(!(device.asked as string[]).includes('listening'), `the device was asked for: ${device.asked.join(', ')}`);
});

test('a device that drops while held: its pages stop showing "listening"', async () => {
  const device = await approved('held-03');
  const page = await listenPage('held-03', false);
  const listening = next(page, 'show', (s) => s === 'listening');
  device.startListening();
  await listening;
  const idle = next(page, 'show', (s) => s === 'idle');
  await goOffline(device);
  await idle;
});

test('Stop listening: the page is no longer ready, its clip stops there, and the device speaks again', async () => {
  const device = await approved('stop-listen-01');
  await admin('PATCH', '/api/devices/stop-listen-01', { speakOn: 'page' });
  const page = await listenPage('stop-listen-01');
  page.autoAck = false;
  const started = next(page, 'start');
  const speaking = next(device, 'show', (s) => s === 'speaking');
  await say('stop-listen-01', LONG);
  await started;
  await speaking;

  const stopped = next(page, 'stopped'); // the bridge ends the clip it was playing there
  const off = next(page, 'status', (s: { ready: boolean; role: string }) => !s.ready && s.role === 'off');
  const idle = next(device, 'show', (s) => s === 'idle'); // it showed "speaking" while the page played
  page.stopListening();
  await stopped;
  await off;
  await idle;
  assert.deepEqual((await overviewDevice('stop-listen-01')).listen, { open: 1, ready: false });

  // As when no page is ready: the device speaks.
  const onPage = count(page, 'start');
  const played = next<Played>(device, 'played');
  const { message } = await say('stop-listen-01', 'Back on the device.');
  assert.match(String(message), /Speaking on stop-listen-01\./);
  assert.equal((await played).kind, 'speech');
  assert.equal(onPage(), 0, 'nothing more on the page');

  // Start listening again: the page plays once more.
  page.autoAck = true;
  const here = next(page, 'status', (s: { role: string }) => s.role === 'here');
  page.start();
  await here;
  const again = next<Played>(page, 'played');
  await say('stop-listen-01', 'And here again.');
  await again;
});

test('Stop listening is not Stop: with Speak on set to both, the device carries on', async () => {
  const device = await approved('stop-listen-02');
  await admin('PATCH', '/api/devices/stop-listen-02', { speakOn: 'both' });
  const page = await listenPage('stop-listen-02');
  const onDevice = count(device, 'stopped');
  const started = next(page, 'start');
  const played = next<Played>(device, 'played');
  await say('stop-listen-02', 'one two three four five six seven eight');
  await started;
  const stopped = next(page, 'stopped');
  page.stopListening();
  await stopped;
  assert.equal((await played).kind, 'speech', 'the device played the clip to its end');
  assert.equal(onDevice(), 0, 'the device was never told to stop');
});

test("the page's Stop stops speech everywhere: on the device too", async () => {
  const device = await approved('stop-01');
  device.realtime = true; // it answers `played` only after the clip's length, like a speaker
  await admin('PATCH', '/api/devices/stop-01', { speakOn: 'both' });
  const page = await listenPage('stop-01');
  const started = next(page, 'start');
  await say('stop-01', LONG);
  await started;
  const onDevice = next(device, 'stopped');
  const idle = next(page, 'show', (s) => s === 'idle');
  page.stopSpeech();
  await onDevice;
  await idle;

  // With Speak on set to the page, the device was showing "speaking": it goes back to idle.
  await admin('PATCH', '/api/devices/stop-01', { speakOn: 'page' });
  const again = next(page, 'start');
  const speaking = next(device, 'show', (s) => s === 'speaking');
  await say('stop-01', LONG);
  await again;
  await speaking;
  const deviceIdle = next(device, 'show', (s) => s === 'idle');
  page.stopSpeech();
  await deviceIdle;
});

test('the error tone plays on the Listen page too', async () => {
  const { id: toneBot } = (await admin('POST', '/api/bots', { name: 'Tone Bot', voice: 'mock' })) as { id: string };
  await approved('tone-01', { bot: toneBot });
  await admin('PATCH', '/api/devices/tone-01', { speakOn: 'page' });
  const page = await listenPage('tone-01');
  const error = next(page, 'show', (s) => s === 'error');
  const tone = next<Played>(page, 'played');
  // The bot has no webhook yet, so a test message fails at once: error face and tone.
  const res = await call('POST', `/api/bots/${toneBot}/test`, { text: 'Hello?' });
  assert.equal(res.status, 400);
  await error;
  assert.equal((await tone).kind, 'tone');
});

test('the history says where each clip played', async () => {
  await approved('history-01');
  await admin('PATCH', '/api/devices/history-01', { speakOn: 'page' });
  const page = await listenPage('history-01');
  const played = next<Played>(page, 'played');
  await say('history-01', 'Noted.');
  await played;
  const { history } = (await admin('GET', '/api/overview')) as { history: Array<{ kind: string; deviceId?: string; detail?: string }> };
  const entry = history.find((h) => h.kind === 'say' && h.deviceId === 'history-01');
  assert.equal(entry?.detail, 'Speaking on the Listen page for history-01.');
});

test('a forgotten device: its pages play for nothing, and a page that sends nonsense is told so', async () => {
  await approved('gone-01');
  const page = await listenPage('gone-01');
  const nothing = next(page, 'status', (s: { device: string | null; devices: Array<{ id: string }> }) => s.device === null && !s.devices.some((d) => d.id === 'gone-01'));
  await admin('DELETE', '/api/devices/gone-01');
  await nothing;

  const told = next<string>(page, 'bridge-error');
  page.sendRaw('{"type":"dance"}');
  assert.equal(await told, 'unrecognised message');
});
