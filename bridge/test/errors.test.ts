import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { errorText } from '../src/errors.ts';

test('a failed fetch says why, not only "fetch failed"', async () => {
  // A port that was just free: nothing listens there.
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));

  const err = await fetch(`http://127.0.0.1:${port}/v1/models`).catch((e: unknown) => e);
  assert.match(errorText(err), /^fetch failed \(.*ECONNREFUSED.*\): nothing is listening at that address and port$/);
});

test('a host name that is not found is explained', () => {
  const err = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND caddy'), { code: 'ENOTFOUND' }) });
  assert.match(errorText(err), /^fetch failed \(getaddrinfo ENOTFOUND caddy\): this machine can't find that host name/);
});

test('errors without a cause, or that already say it, are left as they are', () => {
  assert.equal(errorText(new Error('STT answered 401')), 'STT answered 401');
  const cause = new Error('boom');
  assert.equal(errorText(new Error('it went boom', { cause })), 'it went boom');
  assert.equal(errorText('plain text'), 'plain text');
});
