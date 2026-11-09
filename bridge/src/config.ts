// Settings that come from the environment. Everything else (bots, devices, speech, keys) is set in
// the admin page and kept in the data file.
import path from 'node:path';

export interface Config {
  publicHost: string;
  publicPort: number;
  adminHost: string;
  adminPort: number;
  adminAuth: 'local' | 'cloudflare-access';
  accessTeamDomain: string;
  accessAud: string;
  dataDir: string;
  publicBaseUrl: string;
  logLevel: string;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const auth = env.ADMIN_AUTH ?? 'local';
  if (auth !== 'local' && auth !== 'cloudflare-access') {
    throw new Error(`ADMIN_AUTH must be "local" or "cloudflare-access", not "${auth}"`);
  }
  const config: Config = {
    publicHost: env.PUBLIC_HOST ?? '0.0.0.0',
    publicPort: port(env.PUBLIC_PORT, 8787, 'PUBLIC_PORT'),
    adminHost: env.ADMIN_HOST ?? '127.0.0.1',
    adminPort: port(env.ADMIN_PORT, 8788, 'ADMIN_PORT'),
    adminAuth: auth,
    accessTeamDomain: (env.CF_ACCESS_TEAM_DOMAIN ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    accessAud: env.CF_ACCESS_AUD ?? '',
    dataDir: path.resolve(env.DATA_DIR ?? 'data'),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, ''),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
  // Without Cloudflare Access the admin page has no login, so it may only listen on this computer.
  if (config.adminAuth === 'local' && !LOOPBACK.has(config.adminHost)) {
    throw new Error('ADMIN_AUTH=local needs ADMIN_HOST=127.0.0.1; use ADMIN_AUTH=cloudflare-access to listen elsewhere');
  }
  if (config.adminAuth === 'cloudflare-access' && (!config.accessTeamDomain || !config.accessAud)) {
    throw new Error('ADMIN_AUTH=cloudflare-access needs CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD');
  }
  return config;
}

function port(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`${name} must be a port number, not "${value}"`);
  return n;
}
