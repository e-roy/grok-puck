// The bot's name on the device (spec §4.3.2): the setting and its default, the name in config while it
// is on (and after a rename), firmware without "bot-name" not offered it, names with characters the
// device can't show, the Listen page, and the previews' place, cut and when they show it. Mock speech,
// fake devices.
import assert from 'node:assert/strict';
import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { cutName, NAME_LINE, namePlace, nameShownIn, textWidth } from '../admin/src/lib/botname.ts';
import { MAX_SHOWN, shownName } from '../src/botname.ts';
import { loadConfig } from '../src/config.ts';
import type { DeviceConfig } from '../src/protocol.ts';
import { type Bridge, startBridge } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { FakeDevice } from '../tools/fake-device.ts';
import { FakeListenPage, type PageStatus } from '../tools/fake-listen-page.ts';

let dataDir: string;
let bridge: Bridge;
let botId: string;
const open: Array<FakeDevice | FakeListenPage> = [];

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

interface Overview {
  devices: Array<{ id: string; showBotName: boolean; features: string[] }>;
  bots: Array<{ id: string; name: string; shownName: string }>;
}

function next<T>(emitter: EventEmitter, event: string, check: (value: T) => boolean = () => true, ms = 4000): Promise<T> {
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

/** A fake device, approved for the bot. `attention` acts like firmware 0.6.4; `botName: false` like 0.6.3, which lists attention only. */
async function approved(id: string, options: { attention?: boolean; botName?: boolean; board?: string }): Promise<FakeDevice> {
  const device = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id, networks: ['Home Wi-Fi'], speaking: true, ...options });
  open.push(device);
  const pending = next(device, 'pending');
  await device.connect();
  await pending;
  const config = next(device, 'config');
  await admin('POST', `/api/devices/${id}/approve`, { botId, name: id });
  await config;
  return device;
}

/** Changes a device's setting, and waits for the config it is sent. */
async function setShown(device: FakeDevice, show: boolean): Promise<DeviceConfig> {
  const config = next<DeviceConfig>(device, 'config');
  await admin('PATCH', `/api/devices/${device.id}`, { showBotName: show });
  return config;
}

async function rename(name: string, device: FakeDevice): Promise<DeviceConfig> {
  const config = next<DeviceConfig>(device, 'config', (c) => c.bot?.name === name);
  await admin('PATCH', `/api/bots/${botId}`, { name });
  return config;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-botname-'));
  bridge = await startBridge({ ...loadConfig({}), dataDir, publicPort: 0, adminPort: 0, logLevel: 'silent' });
  ({ id: botId } = await admin<{ id: string }>('POST', '/api/bots', { name: 'Grok' }));
});

after(async () => {
  for (const o of open) o.close();
  await bridge?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the name in the characters a desk can show: accents off, a few letters spelled out, the rest left out', () => {
  const cases: Array<[string, string]> = [
    ['Grok', 'Grok'],
    ['José ✨', 'Jose'],
    ['Zoë Ångström', 'Zoe Angstrom'],
    ['Straße', 'Strasse'],
    ['Ærøskøbing', 'AEroskobing'],
    ['Łukasz', 'Lukasz'],
    ['François Œuvre', 'Francois OEuvre'],
    ['O’Brien “the bot”', `O'Brien "the bot"`],
    ['R2\u2011D2 — helper…', 'R2-D2 - helper...'],
    ['Ｇｒｏｋ', 'Grok'], // full-width letters
    ['Grok✨Bot', 'Grok Bot'], // what is left out may have parted two words
    ['  Grok   Bot  ', 'Grok Bot'],
    ['Grok\tBot\n', 'Grok Bot'],
    ['🤖', ''],
    ['小助手', ''],
    ['Гром', ''],
    ['\u{1F469}\u200D\u{1F4BB} Coder', 'Coder'],
  ];
  for (const [name, shown] of cases) assert.equal(shownName(name), shown, JSON.stringify(name));
  assert.match(shownName('a'.repeat(300)), new RegExp(`^a{${MAX_SHOWN}}$`), 'at most MAX_SHOWN characters are sent');
  for (const [name] of cases) assert.match(shownName(name), /^[ -~]*$/, 'printable ASCII only');
});

test('a new device has the setting off, and its config carries no name', async () => {
  const desk = await approved('name-desk-01', { attention: true });
  assert.ok(desk.botName, 'firmware 0.6.4 lists bot-name');
  const { devices, bots } = await admin<Overview>('GET', '/api/overview');
  const device = devices.find((d) => d.id === 'name-desk-01');
  assert.equal(device?.showBotName, false);
  assert.ok(device?.features.includes('bot-name'));
  assert.equal(bots.find((b) => b.id === botId)?.shownName, 'Grok');
  const config = await setShown(desk, false);
  assert.equal(config.botName, undefined);
  assert.equal(desk.shownName, '');
});

test('with the setting on, config carries the name, and a rename sends the new one at once', async () => {
  const desk = await approved('name-desk-02', { attention: true, board: 'waveshare-amoled-1.8' });
  assert.equal((await setShown(desk, true)).botName, 'Grok');
  assert.equal(desk.shownName, 'Grok');
  const renamed = await rename('Grok Desk Helper', desk);
  assert.equal(renamed.botName, 'Grok Desk Helper');
  assert.equal(renamed.bot?.name, 'Grok Desk Helper', 'bot.name stays the name as typed');
  // A reconnect gets it again in its first config.
  const reconnected = new FakeDevice({ url: desk.url, id: desk.id, key: desk.key, attention: true, board: 'waveshare-amoled-1.8' });
  open.push(reconnected);
  const first = next<DeviceConfig>(reconnected, 'config');
  await reconnected.connect();
  assert.equal((await first).botName, 'Grok Desk Helper');
  // Off again: no name.
  assert.equal((await setShown(reconnected, false)).botName, undefined);
  await rename('Grok', reconnected);
});

test("a name with characters the device can't show: sent as it can show it, or not at all", async () => {
  const desk = await approved('name-desk-03', { attention: true });
  await setShown(desk, true);
  const accented = await rename('José ✨', desk);
  assert.equal(accented.botName, 'Jose');
  assert.equal(accented.bot?.name, 'José ✨');
  let { bots } = await admin<Overview>('GET', '/api/overview');
  assert.equal(bots.find((b) => b.id === botId)?.shownName, 'Jose');
  const none = await rename('小助手', desk);
  assert.equal(none.botName, undefined, 'nothing it can show: no name');
  ({ bots } = await admin<Overview>('GET', '/api/overview'));
  assert.equal(bots.find((b) => b.id === botId)?.shownName, '');
  await rename('Grok', desk);
  await setShown(desk, false);
});

test("firmware without bot-name isn't offered the option: turning it on is refused, and its config carries no name", async () => {
  for (const [id, options] of [
    ['name-older-062', { board: 'waveshare-amoled-1.8' }], // firmware 0.6.2
    ['name-older-063', { attention: true, botName: false }], // firmware 0.6.3: attention, no bot-name
  ] as const) {
    const older = await approved(id, options);
    assert.ok(!older.botName);
    const refused = await call('PATCH', `/api/devices/${id}`, { showBotName: true });
    assert.equal(refused.status, 400);
    assert.match(String(refused.json.error), /firmware can't show the bot's name: firmware 0\.6\.4 and later can/);
    const { devices } = await admin<Overview>('GET', '/api/overview');
    assert.equal(devices.find((d) => d.id === id)?.showBotName, false);
    assert.equal((await setShown(older, false)).botName, undefined, 'turning it off always works');
  }
});

test('a setting saved before a downgrade sends no name to firmware that lacks bot-name', async () => {
  const desk = await approved('name-desk-04', { attention: true });
  await setShown(desk, true);
  desk.close();
  await next(desk, 'closed');
  const older = new FakeDevice({ url: desk.url, id: desk.id, key: desk.key, attention: true, botName: false });
  open.push(older);
  const first = next<DeviceConfig>(older, 'config');
  await older.connect();
  assert.equal((await first).botName, undefined);
  const { devices } = await admin<Overview>('GET', '/api/overview');
  assert.equal(devices.find((d) => d.id === desk.id)?.showBotName, true, 'the setting itself is kept');
});

test('the Listen page gets the name as the device shows it, and its board', async () => {
  const desk = await approved('name-desk-05', { attention: true, board: 'waveshare-amoled-1.8' });
  const page = new FakeListenPage({ url: `ws://127.0.0.1:${bridge.adminPort}/listen/ws`, origin: `http://127.0.0.1:${bridge.adminPort}` });
  open.push(page);
  await page.connect();
  const entry = (s: PageStatus | undefined) => s?.devices.find((d) => d.id === desk.id);
  assert.equal(entry(page.status)?.shown_name, null);
  assert.equal(entry(page.status)?.board, 'waveshare-amoled-1.8');
  const on = next<PageStatus>(page, 'status', (s) => entry(s)?.shown_name === 'Grok');
  await setShown(desk, true);
  await on;
  const renamed = next<PageStatus>(page, 'status', (s) => entry(s)?.shown_name === 'Desk Bot');
  await rename('Désk Bot', desk);
  await renamed;
  await rename('Grok', desk);
  const off = next<PageStatus>(page, 'status', (s) => entry(s)?.shown_name === null);
  await setShown(desk, false);
  await off;
});

test('the setting is kept across a restart, and a data file from before it loads with it off', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-old-'));
  try {
    const old = { id: 'old', name: 'Old', status: 'approved', keyHash: '', botId: '', volume: 70, muted: false, timings: {}, firmware: 'x', firstSeen: '', lastSeen: '' };
    const kept = { ...old, id: 'kept', showBotName: true };
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 1, devices: [old, kept] }));
    const store = new Store(dir);
    assert.equal(store.device('old')?.showBotName, false);
    assert.equal(store.device('kept')?.showBotName, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the previews put the name where the device does: under the ring on the AMOLED-1.8, under the body on the LCD-1.46', () => {
  for (const shape of ['blob', 'teardrop', 'cloud', 'hex', 'squircle', 'circle'] as const) {
    assert.deepEqual(namePlace('waveshare-amoled-1.8', shape), { under: 'ring', width: 295, y: 200, ring: 177, screenHeight: 448 });
  }
  // Under the body: 10 px below the shape's lowest point, as wide as the circle allows 6 px from its edge.
  const lcd = { under: 'body', ring: 198, screenHeight: 412 };
  assert.deepEqual(namePlace('waveshare-lcd-1.46', 'blob'), { ...lcd, width: 226, y: 152 });
  assert.deepEqual(namePlace('waveshare-lcd-1.46', 'teardrop'), { ...lcd, width: 161, y: 170 });
  assert.deepEqual(namePlace('waveshare-lcd-1.46', 'cloud'), { ...lcd, width: 240, y: 125 }, 'at most 240 px');
  assert.deepEqual(namePlace('waveshare-lcd-1.46', 'squircle'), { ...lcd, width: 207, y: 158 });
  assert.equal(namePlace('', 'blob').width, 226, 'no board (older firmware): the LCD-1.46');
  for (const shape of ['blob', 'teardrop', 'cloud', 'hex', 'squircle', 'circle'] as const) {
    const { width, y } = namePlace('waveshare-lcd-1.46', shape);
    assert.ok(Math.hypot(width / 2, y + NAME_LINE / 2) <= 206 - 6 + 0.5, `${shape}: the line's corners stay inside the circle`);
  }
});

test('under the ring the name shows all the time; under the body only at rest, while neither the ring nor the dots show', () => {
  const ring = namePlace('waveshare-amoled-1.8', 'blob');
  const body = namePlace('waveshare-lcd-1.46', 'blob');
  for (const state of ['idle', 'attention', 'offline', undefined]) {
    assert.ok(nameShownIn(ring, state) && nameShownIn(body, state), String(state));
  }
  for (const state of ['listening', 'thinking', 'working', 'waiting', 'speaking', 'error']) {
    assert.ok(nameShownIn(ring, state), state);
    assert.ok(!nameShownIn(body, state), `${state}: the ring or the dots show`);
  }
});

test('the previews cut a long name where LVGL does, ending in three dots, inside the line', () => {
  assert.equal(textWidth('Grok'), 19 + 10 + 16 + 16); // G, r, o, k in the device's Montserrat Bold
  assert.equal(cutName('Grok', 150), 'Grok');
  assert.equal(cutName('abcd', 1), '...', 'no letter fits beside the dots: only the dots, as in LVGL');
  assert.equal(cutName('abc', 1), 'abc', 'three letters or fewer are never cut');
  const long = 'Research Assistant for the Desk';
  for (const width of [150, 177, 225, 295]) {
    const cut = cutName(long, width);
    assert.ok(cut.endsWith('...'), cut);
    assert.ok(textWidth(cut) <= width, `${cut} fits ${width} px`);
    assert.ok(long.startsWith(cut.slice(0, -3)), cut);
    // No more than one letter short of what would still fit beside the dots.
    const more = long.slice(0, cut.length - 3 + 2) + '...';
    assert.ok(textWidth(more) > width, `${more} wouldn't fit ${width} px`);
  }
  // "Research A..." would take 160 px: the dots follow the space, which LVGL keeps.
  assert.equal(cutName('Research Assistant for the Desk', 150), 'Research ...');
  assert.equal(cutName('Research Assistant for the Desk', 295), 'Research Assistant fo...'); // "...for..." takes 300
});

test("the previews' letter widths are the device font's", () => {
  // As LVGL rounds them: the advance in 1/16 px, plus 8, over 16.
  const font = fs.readFileSync(new URL('../../firmware/main/fonts/font_name_bold_24.c', import.meta.url), 'utf8');
  const table = font.slice(font.indexOf('glyph_dsc[] = {'));
  const advances = [...table.slice(0, table.indexOf('};')).matchAll(/\.adv_w = (\d+)/g)].map((m) => (Number(m[1]) + 8) >> 4);
  assert.equal(advances.length, 96, 'the reserved glyph and the 95 printable ASCII characters');
  for (let code = 32; code <= 126; code++) {
    assert.equal(textWidth(String.fromCharCode(code)), advances[code - 31], JSON.stringify(String.fromCharCode(code)));
  }
  assert.match(font, /\.line_height = (\d+),/);
  assert.equal(Number(/\.line_height = (\d+),/.exec(font)?.[1]), NAME_LINE);
});
