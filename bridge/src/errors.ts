// Errors as the admin page and History show them.

// What the usual network causes mean, in words.
const CAUSE_HINTS: Record<string, string> = {
  ENOTFOUND: "this machine can't find that host name (in Docker: is the bridge on that server's network?)",
  EAI_AGAIN: "this machine can't find that host name (in Docker: is the bridge on that server's network?)",
  ECONNREFUSED: 'nothing is listening at that address and port',
};

/**
 * An error's message, with the reason when it has one. Node's fetch only says "fetch failed" and keeps
 * the reason (a host that isn't found, a refused connection, a certificate problem) in `cause`.
 */
export function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause as { message?: unknown; code?: unknown } | undefined;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  const detail = (typeof cause?.message === 'string' && cause.message) || code;
  if (!detail || err.message.includes(detail)) return err.message;
  const hint = CAUSE_HINTS[code];
  return `${err.message} (${detail})${hint ? `: ${hint}` : ''}`;
}
