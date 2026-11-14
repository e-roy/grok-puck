// The firmware badge on the admin page's device cards: the version from the hello's firmware string.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firmwareVersion } from '../admin/src/lib/firmware.ts';

test('the firmware badge shows the version from the firmware string', () => {
  assert.equal(firmwareVersion('desk-display/0.6.1'), '0.6.1');
  assert.equal(firmwareVersion('fake-device/0.6'), '0.6');
  assert.equal(firmwareVersion(' desk-display/0.7.0-dev '), '0.7.0-dev');
  assert.equal(firmwareVersion('0.5.2'), '0.5.2', 'a string without a "/" is the version itself');
});

test('the firmware badge says "unknown" when the hello gives no version', () => {
  assert.equal(firmwareVersion(''), 'unknown');
  assert.equal(firmwareVersion('   '), 'unknown');
  assert.equal(firmwareVersion('desk-display/'), 'unknown');
});
