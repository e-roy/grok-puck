// Voices grouped for the picker. Kokoro's voice names start with the language and the gender:
// `af_heart` is American English, female. Other names (OpenAI's `alloy`…) go under "Other voices".

const LANGUAGES: [string, string][] = [
  ['a', 'American English'],
  ['b', 'British English'],
  ['e', 'Spanish'],
  ['f', 'French'],
  ['h', 'Hindi'],
  ['i', 'Italian'],
  ['j', 'Japanese'],
  ['p', 'Brazilian Portuguese'],
  ['z', 'Mandarin Chinese'],
];

export interface VoiceGroup {
  label: string;
  items: string[];
}

const KOKORO = /^([a-z])([fm])_(.+)$/;

export function groupVoices(voices: string[]): VoiceGroup[] {
  const groups: VoiceGroup[] = [];
  for (const [code, language] of LANGUAGES) {
    for (const [g, gender] of [
      ['f', 'female'],
      ['m', 'male'],
    ]) {
      const items = voices.filter((v) => KOKORO.exec(v)?.[1] === code && KOKORO.exec(v)?.[2] === g);
      if (items.length) groups.push({ label: `${language} · ${gender}`, items });
    }
  }
  const known = new Set(groups.flatMap((group) => group.items));
  const other = voices.filter((v) => !known.has(v));
  if (other.length) groups.push({ label: 'Other voices', items: other });
  return groups;
}

/** `af_heart` → "Heart"; a name without the Kokoro prefix stays as it is. */
export function voiceName(voice: string): string {
  const name = KOKORO.exec(voice)?.[3] ?? voice;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Plays a short sample of a voice in the browser, through the bridge's TTS. */
export async function playSample(voice: string): Promise<void> {
  const res = await fetch('/api/tts/sample', {
    method: 'POST',
    headers: { 'x-desk-admin': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ voice, text: 'Hi! This is how I sound on your desk.' }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
  await new Audio(URL.createObjectURL(await res.blob())).play();
}
