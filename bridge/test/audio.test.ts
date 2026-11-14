import assert from 'node:assert/strict';
import { test } from 'node:test';
import { babble, ERROR_TONE, MIC_RATE, MOCK_VOICE, NO_ANSWER_TONE, readWav, rms, SPEAKER_RATE, tones, wav } from '../src/audio.ts';
import { Clip } from '../src/clip.ts';

/** The pitch of each 20 ms of sound, from its zero crossings. Stretches with any silence in them are left out. */
function pitches(pcm: Buffer, sampleRate: number): number[] {
  const window = Math.round(sampleRate / 50);
  const found: number[] = [];
  next: for (let at = 0; at + window * 2 <= pcm.length; at += window * 2) {
    const piece = pcm.subarray(at, at + window * 2);
    if (rms(piece) < 0.1) continue; // a gap, or a fade in or out
    let crossings = 0;
    let last = 0;
    let zeros = 0;
    for (let i = 0; i < window; i++) {
      const v = piece.readInt16LE(i * 2);
      if (v === 0) {
        if (++zeros >= 10) continue next; // part of a gap between tones
        continue;
      }
      zeros = 0;
      if (last !== 0 && Math.sign(v) !== Math.sign(last)) crossings++;
      last = v;
    }
    found.push((crossings / 2) * 50);
  }
  return found;
}

/** The loudest sample, as a share of full scale. */
function peak(pcm: Buffer): number {
  let max = 0;
  for (let i = 0; i < pcm.length; i += 2) max = Math.max(max, Math.abs(pcm.readInt16LE(i)));
  return max / 32767;
}

const SENTENCE = 'You said: hello from the desk, and this is the mock voice speaking a longer sentence.';

test('a WAV file reads back as the same audio', () => {
  const pcm = tones([{ hz: 440, ms: 100 }], MIC_RATE);
  const info = readWav(wav(pcm, MIC_RATE));
  assert.equal(info.sampleRate, MIC_RATE);
  assert.equal(info.channels, 1);
  assert.equal(info.bits, 16);
  assert.deepEqual(info.pcm, pcm);
});

test('tones have the requested length and are audible', () => {
  const pcm = tones([{ hz: 440, ms: 200, gapMs: 100 }], 24_000);
  assert.equal(pcm.length, 0.3 * 24_000 * 2);
  assert.ok(rms(pcm) > 0.05);
});

test('mock speech gets longer with more words', () => {
  assert.ok(babble('one two three four').length > babble('one').length);
});

test("the mock voice is high enough for the board's small speaker, and never at the alarms' pitches", () => {
  const voice = pitches(babble(SENTENCE), SPEAKER_RATE);
  assert.ok(voice.length > 20, 'enough sound to measure');
  const alarms = [...ERROR_TONE, ...NO_ANSWER_TONE].map((t) => t.hz);
  const highestAlarm = Math.max(...alarms);
  // The old voice sat at 180-340 Hz, which the board's speaker hardly plays.
  assert.ok(Math.min(...voice) >= 1.15 * highestAlarm, `lowest ${Math.min(...voice)} Hz, the alarms reach ${highestAlarm} Hz`);
  assert.ok(Math.max(...voice) <= 1500, `highest ${Math.max(...voice)} Hz`);
  // The alarms measure where they are set, so the check above would catch a voice down among them.
  const alarm = pitches(tones(ERROR_TONE), SPEAKER_RATE);
  assert.ok(Math.max(...alarm) <= highestAlarm * 1.05 && Math.min(...alarm) >= Math.min(...alarms) * 0.95);
});

test('each word of the mock voice glides, where the alarms hold one pitch', () => {
  const word = tones([{ hz: 1000, toHz: 1000 * (1 - MOCK_VOICE.glide), ms: 240 }]);
  const heard = pitches(word, SPEAKER_RATE);
  assert.ok(heard[0] - heard.at(-1)! >= 60, `from ${heard[0]} Hz down to ${heard.at(-1)} Hz`);
  const steady = pitches(tones([{ hz: 660, ms: 240 }]), SPEAKER_RATE);
  assert.ok(Math.max(...steady) - Math.min(...steady) <= 50, 'a steady tone stays put');
});

test('the mock voice is louder than the error tone, which is heard on the board, and never clips', () => {
  const voice = babble(SENTENCE);
  const error = tones(ERROR_TONE);
  assert.ok(rms(voice) > rms(error), `voice ${rms(voice).toFixed(3)}, error tone ${rms(error).toFixed(3)}`);
  assert.ok(rms(voice) > 0.25, `level ${rms(voice).toFixed(3)} (the old voice was about 0.12)`);
  assert.ok(peak(voice) <= MOCK_VOICE.level + 0.001 && peak(voice) < 1, `peak ${peak(voice).toFixed(3)} of full scale`);
  // Asked for more than full scale, a tone stays at full scale: more wouldn't fit in 16 bits.
  assert.ok(peak(tones([{ hz: 1000, ms: 50 }], SPEAKER_RATE, 1.5)) <= 1);
});

test('a clip can be read by two readers while it is still arriving', async () => {
  const clip = new Clip(24_000);
  const first = clip.all();
  const second = clip.all();
  clip.push(Buffer.from([1, 2]));
  clip.push(Buffer.from([3, 4]));
  clip.end();
  assert.deepEqual(await first, Buffer.from([1, 2, 3, 4]));
  assert.deepEqual(await second, Buffer.from([1, 2, 3, 4]));
});
