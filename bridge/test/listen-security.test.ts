// Who may open the Listen page and its WebSocket: the admin page's checks (this computer only, or a
// Cloudflare Access login), plus, for the WebSocket, an Origin that is the page's own address. Access's
// signing keys are replaced by a local test key; nothing is fetched from Cloudflare.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { type Config, loadConfig } from '../src/config.ts';
import { type Bridge, startBridge } from '../src/server.ts';
import { FakeListenPage } from '../tools/fake-listen-page.ts';

const TEAM = 'test-team.cloudflareaccess.example';
const AUD = 'test-audience';

let localDir: string;
let accessDir: string;
let local: Bridge;
let access: Bridge;
let sign: (claims?: { aud?: string; expiresIn?: number }) => Promise<string>;
const pages: FakeListenPage[] = [];

before(async () => {
  localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-sec-'));
  accessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-sec-'));
  const base: Config = { ...loadConfig({}), publicPort: 0, adminPort: 0, logLevel: 'silent' };
  local = await startBridge({ ...base, dataDir: localDir });

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256' };
  sign = ({ aud = AUD, expiresIn = 3600 } = {}) =>
    new SignJWT({ email: 'owner@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(`https://${TEAM}`)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
      .sign(privateKey);
  access = await startBridge(
    { ...base, dataDir: accessDir, adminAuth: 'cloudflare-access', accessTeamDomain: TEAM, accessAud: AUD },
    { accessKeys: createLocalJWKSet({ keys: [jwk] }) },
  );
});

after(async () => {
  for (const page of pages) page.close();
  await local?.close();
  await access?.close();
  fs.rmSync(localDir, { recursive: true, force: true });
  fs.rmSync(accessDir, { recursive: true, force: true });
});

/** Opens the Listen page's socket as a browser tab would; resolves when it is open, or with why not. */
async function connect(bridge: Bridge, options: { origin?: string; headers?: Record<string, string> } = {}): Promise<FakeListenPage | string> {
  const page = new FakeListenPage({ url: `ws://127.0.0.1:${bridge.adminPort}/listen/ws`, ...options });
  pages.push(page);
  try {
    await page.connect();
    return page;
  } catch (err) {
    return (err as Error).message;
  }
}

const own = (bridge: Bridge) => `http://127.0.0.1:${bridge.adminPort}`;

/** A GET with any Host header (fetch won't send a made-up one). */
function get(bridge: Bridge, url: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: bridge.adminPort, path: url, headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
      .on('error', reject);
  });
}

test('local mode: the Listen page opens on this computer', async () => {
  assert.equal(await get(local, '/listen'), 200);
});

test('local mode: the WebSocket needs the Origin of the page itself', async () => {
  assert.equal(await connect(local), 'HTTP 403', 'no Origin');
  assert.equal(await connect(local, { origin: 'https://evil.example' }), 'HTTP 403', "another site's page");
  assert.equal(await connect(local, { origin: `http://127.0.0.1:${local.adminPort + 1}` }), 'HTTP 403', 'another port');
  assert.ok((await connect(local, { origin: own(local) })) instanceof FakeListenPage, 'the page itself');
});

test('local mode: a page reached under another host name is refused (DNS rebinding), Origin or not', async () => {
  assert.equal(await get(local, '/listen', { host: 'desk.example.com' }), 403);
  const rebound = await connect(local, { origin: 'http://desk.example.com', headers: { host: 'desk.example.com' } });
  assert.equal(rebound, 'HTTP 403');
});

test('Access mode: no login, no Listen page and no WebSocket', async () => {
  assert.equal(await get(access, '/listen'), 403);
  assert.equal(await connect(access, { origin: own(access) }), 'HTTP 403');
  const wrongAudience = await sign({ aud: 'another-app' });
  assert.equal(await get(access, '/listen', { 'cf-access-jwt-assertion': wrongAudience }), 403);
  assert.equal(await connect(access, { origin: own(access), headers: { cookie: `CF_Authorization=${wrongAudience}` } }), 'HTTP 403');
  const expired = await sign({ expiresIn: -60 });
  assert.equal(await connect(access, { origin: own(access), headers: { 'cf-access-jwt-assertion': expired } }), 'HTTP 403');
});

test('Access mode: with a login, the page opens, and its WebSocket still needs its Origin', async () => {
  const token = await sign();
  assert.equal(await get(access, '/listen', { 'cf-access-jwt-assertion': token }), 200);
  // A browser sends the login cookie with a WebSocket from any site: the Origin check is what stops that.
  const cookie = { cookie: `CF_Authorization=${token}` };
  assert.equal(await connect(access, { origin: 'https://evil.example', headers: cookie }), 'HTTP 403');
  assert.equal(await connect(access, { headers: cookie }), 'HTTP 403', 'no Origin');
  assert.ok((await connect(access, { origin: own(access), headers: cookie })) instanceof FakeListenPage);
  assert.ok((await connect(access, { origin: own(access), headers: { 'cf-access-jwt-assertion': token } })) instanceof FakeListenPage);
});

test('Access mode: the WebSocket closes when the login ends, as its next request would be refused', async () => {
  const page = await connect(access, { origin: own(access), headers: { 'cf-access-jwt-assertion': await sign({ expiresIn: 2 }) } });
  assert.ok(page instanceof FakeListenPage);
  const [code, reason] = await new Promise<[number, string]>((resolve) => page.once('closed', (c, r) => resolve([c, r])));
  assert.equal(code, 4001);
  assert.match(reason, /sign-in has expired/);
});
