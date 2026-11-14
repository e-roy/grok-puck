// What the bridge accepts from a device (Wi-Fi reports and features in particular) and from a Listen page.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDeviceMessage, parsePageMessage } from '../src/protocol.ts';

const parse = (message: object) => parseDeviceMessage(JSON.stringify(message));

test('a wifi message: names, the one in use, its signal and the setup network', () => {
  assert.deepEqual(parse({ type: 'wifi', saved: ['Home Wi-Fi', 'Phone hotspot'], current: 'Home Wi-Fi', rssi: -58, setup: true }), {
    type: 'wifi',
    saved: ['Home Wi-Fi', 'Phone hotspot'],
    current: 'Home Wi-Fi',
    rssi: -58,
    setup: true,
  });
  // Not on Wi-Fi yet, and an older report without the setup flag.
  assert.deepEqual(parse({ type: 'wifi', saved: [] }), { type: 'wifi', saved: [], current: null, rssi: null, setup: false });
});

test('a wifi message that does not fit is refused', () => {
  assert.equal(parse({ type: 'wifi', saved: ['a', 'b', 'c', 'd', 'e', 'f'] }), undefined, 'more than 5 networks');
  assert.equal(parse({ type: 'wifi', saved: ['x'.repeat(33)] }), undefined, 'a name longer than 32');
  assert.equal(parse({ type: 'wifi', saved: [''] }), undefined, 'an empty name');
  assert.equal(parse({ type: 'wifi', saved: [], rssi: -58.5 }), undefined, 'a signal that is not whole dBm');
  assert.equal(parse({ type: 'wifi', saved: ['a'], password: 'secret' })?.type, 'wifi');
  assert.equal('password' in (parse({ type: 'wifi', saved: ['a'], password: 'secret' }) ?? {}), false, 'unknown fields are dropped');
});

test('hello takes a Wi-Fi report, and a report that does not fit never stops it', () => {
  const hello = { type: 'hello', device_id: 'desk-a1b2c3', firmware: 'desk-display/0.6.0' };
  assert.deepEqual(parse({ ...hello, wifi: { saved: ['Home Wi-Fi'], current: 'Home Wi-Fi', rssi: -60 } }), {
    ...hello,
    wifi: { saved: ['Home Wi-Fi'], current: 'Home Wi-Fi', rssi: -60, setup: false },
  });
  const older = parse(hello); // older firmware sends none
  assert.ok(older?.type === 'hello' && older.wifi === undefined);
  const odd = parse({ ...hello, wifi: { saved: 'Home' } });
  assert.ok(odd?.type === 'hello' && odd.device_id === 'desk-a1b2c3' && odd.wifi === undefined);
});

test('hello says what the firmware can do beyond 0.6.0, and older firmware says nothing', () => {
  const hello = { type: 'hello', device_id: 'desk-a1b2c3', firmware: 'desk-display/0.6.1' };
  const newer = parse({ ...hello, features: ['speaking'] });
  assert.ok(newer?.type === 'hello');
  assert.deepEqual(newer.features, ['speaking']);
  const older = parse({ ...hello, firmware: 'desk-display/0.6.0' });
  assert.ok(older?.type === 'hello' && older.features === undefined);
  // A list that doesn't fit is dropped, never the hello.
  const odd = parse({ ...hello, features: 'speaking' });
  assert.ok(odd?.type === 'hello' && odd.features === undefined);
});

test('a field the bridge does not know is dropped, so a newer hello still works with an older bridge', () => {
  // Bridges before the Listen page parse hello the same way: firmware 0.6.1's "features" is ignored there.
  const hello = parse({ type: 'hello', device_id: 'desk-a1b2c3', firmware: 'desk-display/0.8.0', features: ['speaking'], level: true });
  assert.ok(hello?.type === 'hello');
  assert.equal('level' in hello, false);
});

test("the Listen page's messages", () => {
  const page = (message: object) => parsePageMessage(JSON.stringify(message));
  assert.deepEqual(page({ type: 'listen', device: 'desk-01' }), { type: 'listen', device: 'desk-01', ready: false });
  assert.deepEqual(page({ type: 'listen', device: null, ready: true }), { type: 'listen', device: null, ready: true });
  assert.deepEqual(page({ type: 'start' }), { type: 'start' });
  assert.deepEqual(page({ type: 'played', id: 'a1b2c3d4' }), { type: 'played', id: 'a1b2c3d4', stopped: false });
  assert.deepEqual(page({ type: 'stop' }), { type: 'stop' });
  assert.equal(page({ type: 'listen', device: 'x'.repeat(65) }), undefined, 'a device id longer than any');
  assert.equal(page({ type: 'hello', device_id: 'desk-01' }), undefined, "a device's message");
  assert.equal(parsePageMessage('not json'), undefined);
});
