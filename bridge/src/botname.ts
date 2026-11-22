// The bot's name as a desk shows it under its face (spec §4.3.2). The device's fonts have only basic
// Latin (printable ASCII), so the name is sent in those characters: accents come off, a few letters
// are spelled out, curly quotes and dashes become plain ones, and the rest is left out (emoji, other
// scripts, symbols). The device cuts a long name itself, where its line is full.
import { FEATURE_BOT_NAME } from './protocol.ts';
import type { Device, Store } from './store.ts';

/**
 * What a device shows under its face: its bot's name in the characters it can show, while its Show
 * the bot's name is on and its firmware can (its hello lists "bot-name"); "" for none.
 */
export function nameShownOn(store: Store, device: Device): string {
  const bot = store.bot(device.botId);
  if (!bot || !device.showBotName || !device.features.includes(FEATURE_BOT_NAME)) return '';
  return shownName(bot.name);
}

/** At most this many characters are sent: far more than a desk's line holds. */
export const MAX_SHOWN = 100;

// Letters that have no accent to take off, and punctuation the fonts lack, written in ASCII.
const SPELLED: Record<string, string> = {
  ß: 'ss',
  ẞ: 'SS',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'Th',
  ħ: 'h',
  Ħ: 'H',
  ı: 'i',
  ŧ: 't',
  Ŧ: 'T',
  ŋ: 'n',
  Ŋ: 'N',
  ĸ: 'k',
  '\u2018': "'", // ‘ ’ ‚ ‛
  '\u2019': "'",
  '\u201a': "'",
  '\u201b': "'",
  '\u201c': '"', // “ ” „ ‟
  '\u201d': '"',
  '\u201e': '"',
  '\u201f': '"',
  '\u2010': '-', // ‐ ‑ ‒ – — ―
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2044': '/', // the fraction slash, as in ½ taken apart
};

/** A combining mark: an accent once a letter is taken apart (é → e + ´). */
const MARK = /\p{M}/u;
const SPACE = /\s/u;

/**
 * The bot's name in the characters a desk can show: "José ✨" → "Jose". "" when none of it can be
 * shown (a name in another script, or only emoji).
 */
export function shownName(name: string): string {
  let out = '';
  // NFKD takes letters apart from their accents, and turns full-width letters, ligatures and "…"
  // into plain ones.
  for (const ch of name.normalize('NFKD')) {
    if (ch >= ' ' && ch <= '~') out += ch;
    else if (SPELLED[ch] !== undefined) out += SPELLED[ch];
    else if (SPACE.test(ch)) out += ' ';
    else if (!MARK.test(ch)) out += ' '; // left out, but it may have parted two words
  }
  return out.replace(/ {2,}/g, ' ').trim().slice(0, MAX_SHOWN).trim();
}
