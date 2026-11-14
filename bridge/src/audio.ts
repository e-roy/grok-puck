// The audio formats the device uses, plus a few generated sounds. All audio is 16-bit mono PCM.

export const MIC_RATE = 16_000; // device microphone → bridge
export const SPEAKER_RATE = 24_000; // bridge → device speaker (what OpenAI-style TTS returns as `pcm`)

/** Wraps 16-bit mono PCM in a WAV header. */
export function wav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bits: number;
  pcm: Buffer;
}

/** Reads a PCM WAV file. */
export function readWav(file: Buffer): WavInfo {
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file');
  }
  let format: { code: number; channels: number; sampleRate: number; bits: number } | undefined;
  let offset = 12;
  while (offset + 8 <= file.length) {
    const id = file.toString('ascii', offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        code: file.readUInt16LE(body),
        channels: file.readUInt16LE(body + 2),
        sampleRate: file.readUInt32LE(body + 4),
        bits: file.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!format) throw new Error('WAV data before its format');
      if (format.code !== 1) throw new Error('only uncompressed PCM WAV files are supported');
      const { channels, sampleRate, bits } = format;
      return { channels, sampleRate, bits, pcm: file.subarray(body, Math.min(file.length, body + size)) };
    }
    offset = body + size + (size & 1);
  }
  throw new Error('WAV file has no data');
}

export interface Tone {
  hz: number;
  /** Glides to this pitch by the tone's end (default: stays at `hz`). */
  toHz?: number;
  ms: number;
  gapMs?: number;
}

/** Sine tones with short fades. `level` is the peak, as a share of full scale (at most 1: no clipping). */
export function tones(parts: Tone[], sampleRate = SPEAKER_RATE, level = 0.3): Buffer {
  const samples = (ms: number) => Math.round((ms * sampleRate) / 1000);
  const total = parts.reduce((n, p) => n + samples(p.ms) + samples(p.gapMs ?? 0), 0);
  const out = Buffer.alloc(total * 2);
  const peak = Math.min(1, Math.max(0, level));
  let i = 0;
  for (const part of parts) {
    const n = samples(part.ms);
    const fade = Math.max(1, Math.min(Math.floor(n / 2), samples(10)));
    const glide = (part.toHz ?? part.hz) - part.hz;
    let phase = 0;
    for (let k = 0; k < n; k++) {
      const envelope = Math.min(1, k / fade, (n - k) / fade);
      const value = Math.sin(phase) * envelope * peak;
      out.writeInt16LE(Math.round(value * 32767), i * 2);
      phase += (2 * Math.PI * (part.hz + (glide * k) / n)) / sampleRate;
      i++;
    }
    i += samples(part.gapMs ?? 0);
  }
  return out;
}

export const ERROR_TONE: Tone[] = [
  { hz: 660, ms: 120, gapMs: 60 },
  { hz: 440, ms: 220 },
];

export const NO_ANSWER_TONE: Tone[] = [
  { hz: 520, ms: 160, gapMs: 80 },
  { hz: 520, ms: 160, gapMs: 80 },
  { hz: 390, ms: 260 },
];

/**
 * The mock TTS's voice. The board's small speaker hardly plays anything below about 500 Hz, so it
 * chirps at 900-1260 Hz, each word gliding 10% down or up (810-1390 Hz in all): well above the error
 * and no-answer tones (390-660 Hz, each held at one pitch), and at half of full scale, louder than
 * them (0.3) without clipping.
 */
export const MOCK_VOICE = { lowHz: 900, spanHz: 360, glide: 0.1, level: 0.5 } as const;

/** Stand-in speech for the mock TTS: one short chirp per word, so timing and playback can be tested and heard. */
export function babble(text: string, sampleRate = SPEAKER_RATE): Buffer {
  const words = text.split(/\s+/).filter(Boolean).slice(0, 400);
  const parts = words.map((word, i) => {
    const hz = MOCK_VOICE.lowHz + ((word.length * 37 + i * 53) % MOCK_VOICE.spanHz);
    return {
      hz,
      toHz: hz * (i % 2 ? 1 + MOCK_VOICE.glide : 1 - MOCK_VOICE.glide), // like a voice, it doesn't hold one pitch
      ms: 90 + Math.min(word.length, 10) * 15,
      gapMs: 50,
    };
  });
  return tones(parts, sampleRate, MOCK_VOICE.level);
}

/** Root-mean-square level of 16-bit PCM, from 0 to 1. */
export function rms(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}
