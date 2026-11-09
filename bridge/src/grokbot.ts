// Starting a Grok Bot routine run through its webhook. A 2xx answer only means the run started; the
// bot answers later by calling the bridge's MCP tools.
import type { Bot } from './store.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface VoiceMessage {
  request_id: string;
  text: string;
  device_id: string;
  device_name: string;
  bot_name: string;
  reply_with: string;
  recent?: Array<{ who: 'owner' | 'bot'; text: string }>;
}

/** Why a webhook URL can't be used, or null if it can. The key must not travel over plain HTTP. */
export function webhookUrlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'not a valid URL';
  }
  if (parsed.protocol === 'https:') return null;
  if (parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname)) return null;
  return 'must start with https:// (plain http only for localhost tests)';
}

export async function postWebhook(bot: Bot, message: VoiceMessage): Promise<{ status: number; ms: number }> {
  const problem = webhookUrlProblem(bot.webhookUrl);
  if (problem) throw new Error(`webhook URL ${problem}`);
  const started = performance.now();
  const res = await fetch(bot.webhookUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${bot.webhookKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(message),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  await res.arrayBuffer().catch(() => undefined);
  return { status: res.status, ms: Math.round(performance.now() - started) };
}
