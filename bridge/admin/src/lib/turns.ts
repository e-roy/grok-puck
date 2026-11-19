// The turn records in words (spec §5.11): how a call found its bot, what each check asks, and each
// event as a short line for the History's Turns view.
import type { CheckName, TurnEvent, Via } from '@/api.ts';
import { seconds } from '@/lib/format.ts';

/** How a call found its bot (spec §5.5). */
export const VIA: Record<Via, string> = {
  request: 'by the request_id of a spoken message',
  device: 'by the device it named',
  bot: 'by the bot name it passed',
  only: 'the only bot',
  default: 'the default bot: it named none',
};

/** Each check: its name, and what a failure means. */
export const CHECKS: Record<CheckName, { label: string; failed: string }> = {
  thinking_first: { label: 'Thinking first', failed: 'It didn\'t start with "thinking".' },
  ended: { label: 'Ended', failed: 'It ended without a reply or "idle": the status it left showing expired.' },
  request_id: { label: 'request_id', failed: 'A call missed the request_id of the spoken message.' },
  question_spoken: { label: 'Question spoken', failed: 'It called "waiting" but spoke no question.' },
  no_repeats: { label: 'No repeats', failed: 'It made the same call more than twice in a row.' },
  no_errors: { label: 'No errors', failed: 'The bridge refused or failed one of its calls.' },
};

const SPEECH: Record<string, string> = {
  started: 'speech started',
  played: 'speech played to the end',
  stopped: 'speech stopped',
  kept: 'speech kept for later (offline)',
  muted: 'not spoken: muted',
  failed: 'speech failed',
  offline: 'speech had nowhere to play',
};

const PLACE: Record<string, string> = { device: 'on the device', page: 'on the Listen page', both: 'on the device and the Listen page' };

/** One event of a turn as a short line, and whether it went wrong. */
export function eventText(e: TurnEvent): { what: string; detail?: string; bad?: boolean } {
  if ('call' in e) {
    const what = e.call === 'desk_status' ? `desk_status "${e.state}"` : `desk_say, ${e.chars} characters (${e.spoken} spoken)`;
    const parts = [
      e.request_id ? 'with the request_id' : '',
      e.via ? VIA[e.via] : 'no bot found',
      e.repeat ? `${e.repeat} times in a row` : '',
    ].filter(Boolean);
    return { what, detail: [parts.join(' · '), e.ok ? '' : e.answer].filter(Boolean).join(' — '), bad: !e.ok || (e.repeat ?? 0) > 2 };
  }
  if ('webhook' in e) {
    return e.webhook === 'sent'
      ? { what: `webhook: spoken message sent (${e.chars} characters)` }
      : { what: 'webhook failed', detail: e.answer, bad: true };
  }
  if ('speech' in e) {
    const where = e.place ? ` ${PLACE[e.place] ?? e.place}` : '';
    return { what: `${SPEECH[e.speech] ?? e.speech}${where}`, detail: e.device, bad: e.speech === 'failed' };
  }
  if ('attention' in e) return { what: e.attention === 'started' ? 'attention started' : 'attention ended', detail: e.device };
  return { what: 'no answer within 3 minutes', bad: true };
}

/** "+4.1 s" from the turn's start. */
export function at(ms: number): string {
  return `+${seconds(ms)}`;
}
