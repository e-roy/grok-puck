// A device's board (spec §4.8): what its hello names reaches the overview and the card's badge, and
// devices on older firmware (no board) keep working without one.
import assert from 'node:assert/strict';
import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { boardBadge } from '../admin/src/lib/board.ts';
import { loadConfig } from '../src/config.ts';
import { type Bridge, startBridge } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { FakeDevice } from '../tools/fake-device.ts';

let dataDir: string;
let bridge: Bridge;
const devices: FakeDevice[] = [];

interface OverviewDevice {
  id: string;
  board: string;
  features: string[];
  firmware: string;
}

async function overviewDevice(id: string): Promise<OverviewDevice> {
  const res = await fetch(`http://127.0.0.1:${bridge.adminPort}/api/overview`, { headers: { 'x-desk-admin': '1' } });
  const { devices: list } = (await res.json()) as { devices: OverviewDevice[] };
  const device = list.find((d) => d.id === id);
  assert.ok(device, `${id} is in the overview`);
  return device;
}

function next(emitter: EventEmitter, event: string, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no "${event}" within ${ms} ms`)), ms);
    emitter.once(event, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** A fake device that connects and waits for approval. */
async function waiting(id: string, board?: string): Promise<FakeDevice> {
  const device = new FakeDevice({ url: `ws://127.0.0.1:${bridge.publicPort}/device`, id, networks: ['Home Wi-Fi'], speaking: true, board });
  devices.push(device);
  const pending = next(device, 'pending');
  await device.connect();
  await pending;
  return device;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-board-'));
  bridge = await startBridge({ ...loadConfig({}), dataDir, publicPort: 0, adminPort: 0, logLevel: 'silent' });
});

after(async () => {
  for (const device of devices) device.close();
  await bridge?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the board a hello names is in the overview, with its hardware in features', async () => {
  await waiting('amoled-desk-01', 'waveshare-amoled-1.8');
  const device = await overviewDevice('amoled-desk-01');
  assert.equal(device.board, 'waveshare-amoled-1.8');
  assert.deepEqual(device.features, ['speaking', 'touch', 'microphone', 'speaker']);
  assert.equal(device.firmware, 'fake-device/0.6.2');
});

test('a device on firmware before 0.6.2 has no board', async () => {
  await waiting('older-desk-01');
  const device = await overviewDevice('older-desk-01');
  assert.equal(device.board, '');
  assert.deepEqual(device.features, ['speaking']);
});

test('a device that reconnects with other firmware takes the board its new hello names', async () => {
  const first = await waiting('moved-desk-01', 'waveshare-lcd-1.46');
  assert.equal((await overviewDevice('moved-desk-01')).board, 'waveshare-lcd-1.46');
  const closed = next(first, 'closed');
  first.close();
  await closed;
  await waiting('moved-desk-01');
  assert.equal((await overviewDevice('moved-desk-01')).board, '', 'older firmware again: no board');
});

test('a data file from before boards loads with no board', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-old-'));
  try {
    const old = { id: 'old', name: 'Old', status: 'approved', keyHash: '', botId: '', volume: 70, muted: false, timings: {}, firmware: 'x', firstSeen: '', lastSeen: '' };
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 1, devices: [old] }));
    assert.equal(new Store(dir).device('old')?.board, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the card's badge: a short name with the full one on hover, the id for a board it doesn't know, none without one", () => {
  assert.deepEqual(boardBadge('waveshare-amoled-1.8'), { label: 'AMOLED-1.8', title: 'Board: Waveshare ESP32-S3-Touch-AMOLED-1.8' });
  assert.deepEqual(boardBadge('waveshare-lcd-1.46'), { label: 'LCD-1.46', title: 'Board: Waveshare ESP32-S3-Touch-LCD-1.46' });
  assert.deepEqual(boardBadge('someone-new-2.0'), { label: 'someone-new-2.0', title: 'Board: someone-new-2.0' });
  assert.equal(boardBadge(''), null);
  assert.equal(boardBadge('  '), null);
});
