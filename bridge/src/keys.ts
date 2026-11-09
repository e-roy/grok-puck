// Keys the bridge hands out (MCP key, device keys). Only their SHA-256 hashes are stored.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function newKey(): string {
  return randomBytes(32).toString('base64url');
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function keyMatches(key: string | undefined, hash: string): boolean {
  if (!key || !hash) return false;
  const a = Buffer.from(hashKey(key), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The token of an `Authorization: Bearer <token>` header. */
export function bearer(header: string | undefined): string | undefined {
  return /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1];
}

/** How a stored secret is shown in the admin page: never in full. */
export function masked(secret: string): string {
  return secret ? `••••${secret.slice(-4)}` : '';
}
