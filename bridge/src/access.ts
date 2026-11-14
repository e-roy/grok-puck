// Checks the login token Cloudflare Access adds to every request it lets through to the admin page,
// so the page stays closed even to a request that reaches the bridge some other way.
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

/** Who signed in, and when that login ends (ms since 1970; undefined if the token doesn't say). */
export interface AccessLogin {
  who: string;
  expires: number | undefined;
}

export type AccessVerifier = (token: string | undefined) => Promise<AccessLogin | null>;

/** `keys` replaces Access's published signing keys (tests only). */
export function accessVerifier(teamDomain: string, audience: string, keys?: JWTVerifyGetKey): AccessVerifier {
  const issuer = `https://${teamDomain}`;
  const getKey = keys ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  return async (token) => {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, getKey, { issuer, audience });
      return {
        who: String(payload.email ?? payload.sub ?? 'user'),
        expires: typeof payload.exp === 'number' ? payload.exp * 1000 : undefined,
      };
    } catch {
      return null;
    }
  };
}
