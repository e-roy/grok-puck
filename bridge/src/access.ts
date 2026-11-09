// Checks the login token Cloudflare Access adds to every request it lets through to the admin page,
// so the page stays closed even to a request that reaches the bridge some other way.
import { createRemoteJWKSet, jwtVerify } from 'jose';

export type AccessVerifier = (token: string | undefined) => Promise<string | null>;

export function accessVerifier(teamDomain: string, audience: string): AccessVerifier {
  const issuer = `https://${teamDomain}`;
  const keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  return async (token) => {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, keys, { issuer, audience });
      return String(payload.email ?? payload.sub ?? 'user');
    } catch {
      return null;
    }
  };
}
