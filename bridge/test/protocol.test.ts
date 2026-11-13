// What the bridge accepts from a device, Wi-Fi reports in particular.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDeviceMessage } from '../src/protocol.ts';

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
