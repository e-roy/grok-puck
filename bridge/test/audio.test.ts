import assert from 'node:assert/strict';
import { test } from 'node:test';
import { babble, MIC_RATE, readWav, rms, tones, wav } from '../src/audio.ts';
import { Clip } from '../src/clip.ts';

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
