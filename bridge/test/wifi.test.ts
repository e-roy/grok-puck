// Saved Wi-Fi networks: what devices report, and the admin page's Wi-Fi setup, Forget and Forget all.
import assert from 'node:assert/strict';
import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { loadConfig } from '../src/config.ts';
import { type Bridge, startBridge } from '../src/server.ts';
import { FakeDevice, type Played } from '../tools/fake-device.ts';

interface Wifi {
  saved: string[];
  current: string | null;
  rssi: number | null;
  setup: boolean;
  at: string;
}
interface OverviewDevice {
  id: string;
  online: boolean;
  firmware: string;
  wifi: Wifi | null;
}

let dataDir: string;
let bridge: Bridge;
let botId: string;
const devices: FakeDevice[] = [];

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
  const { devices: list } = (await admin('GET', '/api/overview')) as unknown as { devices: OverviewDevice[] };
  const device = list.find((d) => d.id === id);
  assert.ok(device, `${id} is in the overview`);
  return device;
}

/** Polls the overview until `check` passes for that device (the device's report arrives on its own). */
async function eventually(id: string, check: (d: OverviewDevice) => boolean, ms = 4000): Promise<OverviewDevice> {
  const until = Date.now() + ms;
  for (;;) {
    const device = await overviewDevice(id);
    if (check(device)) return device;
    if (Date.now() > until) assert.fail(`${id} never matched: ${JSON.stringify(device.wifi)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function next<T>(emitter: EventEmitter, event: string, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no "${event}" within ${ms} ms`)), ms);
    emitter.once(event, (value: T) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

/** A fake device that connects, is approved with the test bot, and has its config. */
async function approved(id: string, networks?: string[], key?: string): Promise<FakeDevice> {
  const device = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id, networks, key });
  devices.push(device);
  if (key) {
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

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-wifi-'));
  bridge = await startBridge({ ...loadConfig({}), dataDir, publicPort: 0, adminPort: 0, logLevel: 'silent' });
  ({ id: botId } = (await admin('POST', '/api/bots', { name: 'Desk Bot', voice: 'mock' })) as { id: string });
});

after(async () => {
  for (const device of devices) device.close();
  await bridge?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a device reports its saved networks in hello, and the overview shows them', async () => {
  const device = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id: 'wifi-desk-01', networks: ['Home Wi-Fi', 'Phone hotspot'] });
  devices.push(device);
  const pending = next(device, 'pending');
  await device.connect();
  await pending;
  const { wifi } = await overviewDevice('wifi-desk-01');
  assert.ok(wifi?.at);
  assert.deepEqual({ ...wifi, at: undefined }, { saved: ['Home Wi-Fi', 'Phone hotspot'], current: 'Home Wi-Fi', rssi: -58, setup: false, at: undefined });

  const config = next(device, 'config');
  await admin('POST', '/api/devices/wifi-desk-01/approve', { botId, name: 'Travel desk' });
  await config;
});

test('a Wi-Fi message from the device updates the overview', async () => {
  devices[0]!.updateWifi({ rssi: -71 });
  await eventually('wifi-desk-01', (d) => d.wifi?.rssi === -71);
});

test('Wi-Fi setup tells the device to open its setup network', async () => {
  const told = next(devices[0]!, 'wifi-setup');
  const { message } = await admin('POST', '/api/devices/wifi-desk-01/wifi-setup', {});
  assert.match(String(message), /Travel desk opens its setup network for 10 minutes/);
  await told;
  await eventually('wifi-desk-01', (d) => d.wifi?.setup === true);
});

test('Forget one network: the device forgets it and reports the networks it still has', async () => {
  const device = devices[0]!;
  const told = next<string>(device, 'forget-network');
  await admin('POST', '/api/devices/wifi-desk-01/forget-network', { ssid: 'Phone hotspot' });
  assert.equal(await told, 'Phone hotspot');
  const { wifi } = await eventually('wifi-desk-01', (d) => d.wifi?.saved.length === 1);
  assert.deepEqual(wifi?.saved, ['Home Wi-Fi']);
  assert.equal(wifi?.current, 'Home Wi-Fi');

  const unknown = await call('POST', '/api/devices/wifi-desk-01/forget-network', { ssid: 'Phone hotspot' });
  assert.equal(unknown.status, 400);
  assert.match(String(unknown.json.error), /no saved network by that name/);
  assert.equal((await call('POST', '/api/devices/wifi-desk-01/forget-network', { ssid: '' })).status, 400);
  assert.equal((await call('POST', '/api/devices/nobody/forget-network', { ssid: 'Home Wi-Fi' })).status, 404);

  const { history } = (await admin('GET', '/api/overview')) as { history: Array<{ detail?: string }> };
  assert.ok(history.some((h) => h.detail === 'told to forget the Wi-Fi network "Phone hotspot"'));
});

test('Forgetting the network in use: the device moves to another saved one', async () => {
  const device = await approved('wifi-desk-02', ['Office', 'Home Wi-Fi', 'Cafe']);
  const told = next<string>(device, 'forget-network');
  await admin('POST', '/api/devices/wifi-desk-02/forget-network', { ssid: 'Office' });
  await told;
  const { wifi } = await eventually('wifi-desk-02', (d) => d.wifi?.saved.length === 2);
  assert.deepEqual([wifi?.saved, wifi?.current], [['Home Wi-Fi', 'Cafe'], 'Home Wi-Fi']);
});

test('Forget all networks still goes to the device', async () => {
  const told = next(devices[0]!, 'forget-wifi');
  await admin('POST', '/api/devices/wifi-desk-01/forget-wifi', {});
  await told;
});

test('an offline device keeps its last report, and Wi-Fi setup and Forget are refused', async () => {
  const device = devices[0]!;
  device.close();
  await next(device, 'closed');
  const { online, wifi } = await eventually('wifi-desk-01', (d) => !d.online);
  assert.equal(online, false);
  assert.deepEqual(wifi?.saved, ['Home Wi-Fi'], 'the last report is still shown');
  for (const [url, body] of [
    ['/api/devices/wifi-desk-01/wifi-setup', {}],
    ['/api/devices/wifi-desk-01/forget-network', { ssid: 'Home Wi-Fi' }],
    ['/api/devices/wifi-desk-01/forget-wifi', {}],
  ] as const) {
    const res = await call('POST', url, body);
    assert.equal(res.status, 400, url);
    assert.match(String(res.json.error), /must be online/);
  }
});

test('a device on older firmware reports no networks and keeps working', async () => {
  const device = await approved('old-desk-01');
  const { wifi, firmware } = await overviewDevice('old-desk-01');
  assert.equal(wifi, null);
  assert.equal(firmware, 'fake-device/0.5');

  // It doesn't know these messages, so the bridge doesn't send them.
  let unexpected = '';
  device.once('wifi-setup', () => (unexpected = 'wifi-setup'));
  device.once('forget-network', () => (unexpected = 'forget-network'));
  for (const [url, body] of [
    ['/api/devices/old-desk-01/wifi-setup', {}],
    ['/api/devices/old-desk-01/forget-network', { ssid: 'Home Wi-Fi' }],
  ] as const) {
    const res = await call('POST', url, body);
    assert.equal(res.status, 400, url);
    assert.match(String(res.json.error), /firmware 0\.6\.0 or later/);
  }

  // Forget all networks is today's wifi.forget, which it knows; speech works as before.
  const forgot = next(device, 'forget-wifi');
  await admin('POST', '/api/devices/old-desk-01/forget-wifi', {});
  await forgot;
  const played = next<Played>(device, 'played');
  await admin('POST', '/api/devices/old-desk-01/say', { text: 'Still here.' });
  assert.equal((await played).kind, 'speech');
  assert.equal(unexpected, '');
});

test('a device that goes back to older firmware no longer shows networks', async () => {
  const device = await approved('wifi-desk-03', ['Home Wi-Fi']);
  assert.ok((await overviewDevice('wifi-desk-03')).wifi);
  const key = device.key;
  device.close();
  await next(device, 'closed');
  await approved('wifi-desk-03', undefined, key); // the same device, saying hello without networks
  assert.equal((await overviewDevice('wifi-desk-03')).wifi, null);
});

test("a Wi-Fi report that doesn't fit doesn't stop a device from connecting", async () => {
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.publicPort}/device`);
  await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
  const answer = new Promise<{ type: string }>((resolve) => socket.once('message', (data) => resolve(JSON.parse(String(data)))));
  const tooMany = ['a', 'b', 'c', 'd', 'e', 'f'];
  socket.send(JSON.stringify({ type: 'hello', device_id: 'odd-desk-01', firmware: 'x/1', wifi: { saved: tooMany, current: 'a' } }));
  assert.equal((await answer).type, 'pending');
  assert.equal((await overviewDevice('odd-desk-01')).wifi, null);
  socket.close();
});
