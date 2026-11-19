// Turn records (spec §5.11): how calls are grouped into turns, each check passing and failing, the
// timings, the export, and what is kept in turns.json (bounded, and readable after a restart).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { type CallInput, TURN_DAYS, TURN_LIMIT, TurnLog, type TurnView } from '../src/turns.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A turn log in a new folder, on a clock the test moves. */
function setup(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-turns-'))) {
  if (!dirs.includes(dir)) dirs.push(dir);
  const clock = { now: Date.parse('2026-11-20T14:00:00.000Z') };
  const log = new TurnLog(dir, {}, () => clock.now);
  const advance = (ms: number) => {
    clock.now += ms;
  };
  return { dir, log, clock, advance };
}

const TEST_BOT = { botId: 'b-test', bot: 'Test Bot', via: 'bot' as const, devices: ['Desk'] };

function status(log: TurnLog, state: string, extra: Partial<CallInput> = {}) {
  const call = log.call({ tool: 'desk_status', state, ...TEST_BOT, ...extra });
  call.event.answer = `Showing "${state}" on Desk.`;
  return call;
}

function say(log: TurnLog, text: string, extra: Partial<CallInput> = {}) {
  const call = log.call({ tool: 'desk_say', text, spoken: text.length, ...TEST_BOT, ...extra });
  call.event.answer = 'Speaking on Desk.';
  return call;
}

function only(log: TurnLog): TurnView {
  const { turns } = log.list();
  assert.equal(turns.length, 1, `one turn: ${JSON.stringify(turns.map((t) => t.events))}`);
  return turns[0];
}

test('a typed turn that follows the instructions passes every check, with its timings', () => {
  const { log, advance } = setup();
  const first = status(log, 'thinking');
  assert.equal(first.started, true, 'the first call starts a turn');
  advance(4100);
  assert.equal(status(log, 'working').started, false);
  advance(23_200);
  const reply = say(log, 'The capital of Australia is Canberra.');
  advance(400);
  log.speech(reply.turn, 'Desk', 'started', 'device');
  advance(13_000);
  log.speech(reply.turn, 'Desk', 'played');

  let turn = only(log);
  assert.equal(turn.open, true, 'open until 30 s after the reply');
  assert.equal(turn.kind, 'typed');
  assert.deepEqual(turn.devices, ['Desk']);
  assert.deepEqual(turn.checks, {
    thinking_first: 'pass',
    ended: 'pass',
    request_id: 'n/a',
    question_spoken: 'n/a',
    no_repeats: 'pass',
    no_errors: 'pass',
  });
  assert.deepEqual(turn.timings, { reply_ms: 27_300, speech_wait_ms: 400, speech_ms: 13_000, total_ms: 40_700 });
  assert.deepEqual(turn.notes, []);
  const event = turn.events[2];
  assert.ok('call' in event && event.call === 'desk_say');
  assert.equal(event.chars, 37);
  assert.equal(event.request_id, false);
  assert.equal(event.via, 'bot');

  advance(30_000);
  turn = only(log);
  assert.equal(turn.open, false);
  assert.equal(turn.end, '2026-11-20T14:00:40.700Z');
});

test("a turn's first call is at +0, even on a clock that moves while it is recorded", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-turns-'));
  dirs.push(dir);
  let now = Date.parse('2026-11-20T14:00:00.000Z');
  const log = new TurnLog(dir, {}, () => now++); // every read is a millisecond later
  status(log, 'thinking');
  const [turn] = log.list().turns;
  assert.equal(turn.events[0].ms, 0);
});

test('typed turns: a reply then 30 s of quiet, "idle", a "thinking" after a reply or a "waiting", and 10 minutes all end one', () => {
  const { log, advance } = setup();
  status(log, 'thinking');
  say(log, 'One.');
  advance(29_000);
  assert.equal(status(log, 'idle').started, false, 'within 30 s of the reply: the same turn');
  assert.equal(status(log, 'working').started, true, 'after "idle": a new turn');
  advance(9 * 60_000);
  assert.equal(status(log, 'working').started, false, 'within 10 minutes of its last call: the same turn');
  advance(10 * 60_000);
  assert.equal(say(log, 'Two.').started, true, '10 minutes after its last call: a new turn');
  advance(5000);
  assert.equal(status(log, 'thinking').started, true, 'a "thinking" after a reply starts a new turn');
  status(log, 'waiting');
  advance(5000);
  assert.equal(status(log, 'thinking').started, true, 'a "thinking" after a "waiting": the owner answered');
  assert.equal(log.list().turns.length, 5);
});

test('calls from different bots, and from a bot the bridge does not know, are kept apart', () => {
  const { log } = setup();
  status(log, 'thinking');
  status(log, 'thinking', { botId: 'b-main', bot: 'Main', via: 'default' });
  const unknown = status(log, 'thinking', { botId: '', bot: 'Tset Bot', via: undefined });
  unknown.event.ok = false;
  const { turns } = log.list();
  assert.deepEqual(turns.map((t) => t.bot).sort(), ['Main', 'Test Bot', 'Tset Bot']);
  const main = turns.find((t) => t.bot === 'Main');
  assert.match(main?.notes.join(' ') ?? '', /only as the default bot/);
  assert.equal(turns.find((t) => t.bot === 'Tset Bot')?.checks.no_errors, 'fail');
});

test('a voice turn groups its calls by request_id, and flags a call that misses it', () => {
  const { log, advance } = setup();
  log.voice({ botId: 'b-test', bot: 'Test Bot', requestId: 'r-1', devices: ['Desk'], chars: 24 });
  advance(9000);
  status(log, 'thinking', { requestId: 'r-1', via: 'request' });
  advance(21_000);
  say(log, 'Tokyo is in Japan Standard Time.', { requestId: 'r-1', via: 'request' });
  let turn = only(log);
  assert.equal(turn.kind, 'voice');
  assert.equal(turn.checks.request_id, 'pass');
  assert.equal(turn.timings.first_call_ms, 9000);
  assert.equal(turn.timings.reply_ms, 30_000);

  // The next voice turn's reply forgets the request_id: it still joins, and fails the check.
  advance(60_000);
  log.voice({ botId: 'b-test', bot: 'Test Bot', requestId: 'r-2', devices: ['Desk'], chars: 10 });
  status(log, 'thinking', { requestId: 'r-2', via: 'request' });
  say(log, 'An answer.');
  const [latest] = log.list().turns;
  assert.equal(latest.request_id, 'r-2');
  assert.equal(latest.events.length, 3);
  assert.equal(latest.checks.request_id, 'fail');

  // A late reply with its request_id still finds its own turn, even after the turn closed.
  advance(20 * 60_000);
  say(log, 'Late, but with the request_id.', { requestId: 'r-1', via: 'request' });
  turn = log.list().turns.find((t) => t.request_id === 'r-1')!;
  assert.equal(turn.events.filter((e) => 'call' in e).length, 3);
});

test('a voice turn with no reply: "ended" is pending while it is open, then fails; no answer is noted', () => {
  const { log, advance } = setup();
  const ref = log.voice({ botId: 'b-test', bot: 'Test Bot', requestId: 'r-1', devices: ['Desk'], chars: 5 });
  assert.equal(only(log).checks.ended, 'pending');
  assert.equal(only(log).checks.thinking_first, 'pending');
  advance(180_000);
  log.noAnswer(ref);
  advance(9 * 60_000);
  say(log, 'Sorry, I was slow.', { requestId: 'r-1', via: 'request' });
  assert.match(only(log).notes.join(' '), /after the 3 minutes/);

  const { log: other, advance: later } = setup();
  other.voice({ botId: 'b-test', bot: 'Test Bot', requestId: 'r-9', devices: ['Desk'], chars: 5 });
  later(10 * 60_000);
  const turn = only(other);
  assert.equal(turn.open, false);
  assert.equal(turn.checks.ended, 'fail');
  assert.equal(turn.checks.thinking_first, 'fail');
});

test('a webhook that failed: the bot never got the message, so nothing is checked', () => {
  const { log } = setup();
  const ref = log.voice({ botId: 'b-test', bot: 'Test Bot', requestId: 'r-1', devices: ['Desk'], chars: 5 });
  log.webhookFailed(ref, 'it answered HTTP 401');
  const turn = only(log);
  assert.equal(turn.open, false);
  assert.ok(Object.values(turn.checks).every((c) => c === 'n/a'));
  assert.match(turn.notes[0], /webhook failed.*HTTP 401/);
});

test('each check fails when the bot misses what it asks', () => {
  const { log, advance } = setup();
  // No "thinking" first, and a status left showing: it expires.
  status(log, 'working');
  let turn = only(log);
  assert.equal(turn.checks.thinking_first, 'fail');
  assert.equal(turn.checks.ended, 'pending');
  advance(10 * 60_000);
  turn = only(log);
  assert.equal(turn.checks.ended, 'fail');

  // The same call three times in a row, and a refused call.
  advance(60_000);
  for (let i = 0; i < 3; i++) status(log, 'thinking');
  const refused = say(log, 'Hello.');
  refused.event.ok = false;
  refused.event.answer = 'Too many desk_say calls this hour; try again later.';
  [turn] = log.list().turns;
  assert.equal(turn.checks.no_repeats, 'fail');
  assert.equal(turn.checks.no_errors, 'fail');
  const repeats = turn.events.map((e) => ('call' in e ? (e.repeat ?? 1) : 0));
  assert.deepEqual(repeats, [1, 2, 3, 1]);

  // Twice in a row is allowed; the same text twice counts as the same call.
  advance(60_000);
  status(log, 'thinking');
  say(log, 'Same words.');
  say(log, 'Same words.');
  [turn] = log.list().turns;
  assert.equal(turn.checks.no_repeats, 'pass');

  // "waiting" with no question spoken.
  advance(60_000);
  status(log, 'thinking');
  status(log, 'waiting');
  [turn] = log.list().turns;
  assert.equal(turn.checks.question_spoken, 'pending');
  advance(30_000);
  [turn] = log.list().turns;
  assert.equal(turn.checks.question_spoken, 'fail');
  assert.equal(turn.checks.ended, 'fail');
});

test('"question spoken" passes with the question after "waiting", or before it with a note', () => {
  const { log, advance } = setup();
  status(log, 'thinking');
  status(log, 'waiting');
  say(log, 'Which name do you like?');
  let [turn] = log.list().turns;
  assert.equal(turn.checks.question_spoken, 'pass');
  assert.deepEqual(turn.notes, ['No "working": right only if it used no tools.']);

  advance(60_000);
  status(log, 'thinking');
  say(log, 'Which one?');
  status(log, 'waiting');
  [turn] = log.list().turns;
  assert.equal(turn.checks.question_spoken, 'pass');
  assert.match(turn.notes.join(' '), /asked before calling "waiting"/);
});

test('attention starting and ending is recorded in the turn', () => {
  const { log } = setup();
  const asked = status(log, 'waiting');
  log.attention(asked.turn, 'Desk', 'started');
  const turn = only(log);
  assert.ok(turn.events.some((e) => 'attention' in e && e.attention === 'started' && e.device === 'Desk'));
});

test('the export has a summary and no text', () => {
  const { log, advance } = setup();
  const secret = 'The reply text never leaves the bridge in a record.';
  status(log, 'thinking');
  say(log, secret);
  advance(60_000);
  status(log, 'working');
  say(log, 'Short.');
  advance(60_000);
  status(log, 'thinking', { botId: 'b-main', bot: 'Main', via: 'default' });
  advance(10 * 60_000); // its "thinking" expires: the turn ends without a reply

  const exported = log.export();
  const json = JSON.stringify(exported);
  assert.ok(!json.includes(secret) && !json.includes('Short.'), 'no reply text');
  assert.equal(exported.summary.turns, 3);
  assert.equal(exported.summary.typed, 3);
  assert.equal(exported.summary.open, 0);
  assert.equal(exported.summary.all_checks_passed, 1);
  assert.deepEqual(exported.summary.checks.thinking_first, { pass: 2, fail: 1, 'n/a': 0, pending: 0 });
  assert.deepEqual(exported.summary.timings.typed_reply_ms, { n: 2, median: 0, min: 0, max: 0 });

  const one = log.export('test bot');
  assert.equal(one.summary.turns, 2, 'one bot, by its name');
  assert.equal(one.bot, 'test bot');
});

test('turns are kept in turns.json and read back after a restart, later calls join them', () => {
  const { dir, log, clock } = setup();
  status(log, 'thinking');
  log.flush();
  const again = new TurnLog(dir, {}, () => clock.now);
  assert.equal(again.list().turns.length, 1);
  assert.equal(again.call({ tool: 'desk_status', state: 'working', ...TEST_BOT }).started, false, 'joins the open turn');
  assert.equal(again.call({ tool: 'desk_status', state: 'thinking', botId: 'b-main', bot: 'Main', devices: [] }).turn.id, 2, 'ids carry on');
});

test('turns.json keeps the last 30 days, and never more than 500 turns', () => {
  const { dir, log, clock, advance } = setup();
  for (let i = 0; i < TURN_LIMIT + 20; i++) {
    status(log, 'idle'); // each "idle" ends its turn, so every call is a turn of its own
    advance(1000);
  }
  log.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'turns.json'), 'utf8')) as { turns: Array<{ id: number }> };
  assert.equal(saved.turns.length, TURN_LIMIT);
  assert.equal(saved.turns[0].id, 21, 'the oldest went first');

  advance((TURN_DAYS - 1) * 86_400_000);
  status(log, 'idle');
  assert.equal(log.list().total, TURN_LIMIT, 'still within 30 days');
  advance(2 * 86_400_000);
  status(log, 'idle');
  assert.equal(log.list().total, 2, 'the turns older than 30 days are gone');

  const later = new TurnLog(dir, {}, () => clock.now + 40 * 86_400_000);
  assert.equal(later.list().total, 0, 'a restart drops them too');
});

test('a turns.json that cannot be read is set aside, and the bridge starts with none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-turns-'));
  fs.writeFileSync(path.join(dir, 'turns.json'), '{ not json');
  const { log } = setup(dir);
  assert.equal(log.list().total, 0);
  assert.ok(fs.existsSync(path.join(dir, 'turns.json.unreadable')));
  status(log, 'thinking');
  log.flush();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'turns.json'), 'utf8')).turns.length, 1);

  // No file at all (an older bridge's data folder): none.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-turns-'));
  assert.equal(setup(empty).log.list().total, 0);
});
