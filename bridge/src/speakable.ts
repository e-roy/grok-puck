// Turns what a bot typed (usually Markdown) into text a TTS voice can read aloud. Everything is kept
// except what doesn't survive being read out: code blocks, URLs, formatting marks and emoji.

const TABLE_RULE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

export function speakable(input: string): string {
  let text = input.replace(/\r\n?/g, '\n');
  // Fenced code, including a block the bot never closed.
  text = text.replace(/(```|~~~)[\s\S]*?(\1|$)/g, '\nCode omitted.\n');
  text = text.replace(/<\/?[a-z][^>\n]*>/gi, ' ');
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => alt || 'image');
  text = text.replace(/\[([^\]]+)\]\((?:[^()\s]|\([^)]*\))*\)/g, '$1');
  // A URL, without the punctuation that ends the sentence around it.
  text = text.replace(/\b(?:https?:\/\/|www\.)[^\s<>()]*[^\s<>().,;:!?'"]/gi, 'link');
  text = text.replace(/`([^`\n]+)`/g, '$1');

  const lines = text.split('\n').map((raw) => {
    let line = raw.trim();
    if (TABLE_RULE.test(line) || /^[-*_]{3,}$/.test(line)) return '';
    if (/^\|.*\|$/.test(line)) {
      line = line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(', ');
    }
    line = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^([-*+]|\d+[.)])\s+/, '')
      .replace(/^\[[ xX]\]\s+/, '');
    return line
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(?<!\w)__(.+?)__(?!\w)/g, '$1')
      .replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
      .replace(/(?<!\w)_(\S(?:.*?\S)?)_(?!\w)/g, '$1')
      .replace(/~~(.+?)~~/g, '$1');
  });

  // A line that ends without punctuation (a heading, a list item) gets a full stop so the voice pauses.
  text = lines
    .filter(Boolean)
    .map((line) => (/[.!?:;,)]$/.test(line) ? line : `${line}.`))
    .join(' ');
  text = text.replace(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu, '');
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/(^|\s)[.,;:]+(?=\s|$)/g, '$1')
    .trim();
}
