// The bot's name as a desk draws it under its face (spec §4.3.2), for the previews on the device's
// card and the Listen page: where it sits on each board and shape, when it shows, and where the device
// cuts a long one, measured with the letter widths of the device's font. It follows
// firmware/main/face.c, so change the two together. Plain code (one import, also plain), so the
// bridge's tests can check it too (bridge/test/botname.test.ts).
import { boardScreen } from './board.ts';

// The device's font for the name, Montserrat Bold at 24 px (firmware/main/fonts/font_name_bold_24.c):
// how far each printable ASCII character moves the pen, in pixels, from " " to "~". Kerning is left
// out, so a cut can land a letter away from the device's.
const ADVANCE = [
  7, 7, 11, 17, 15, 21, 18, 6, 9, 9, 10, 14, 6, 9, 6, 9, 16, 9, 14, 14, 17, 14, 15, 15, 16, 15, 6, 6, 14, 14, 14, 14, 25, 18, 18, 18,
  20, 16, 15, 19, 19, 8, 13, 18, 15, 23, 19, 20, 18, 20, 18, 15, 15, 19, 18, 28, 17, 16, 16, 9, 9, 9, 14, 12, 14, 15, 17, 14, 17, 15,
  9, 17, 17, 7, 7, 16, 7, 25, 17, 16, 17, 17, 10, 13, 10, 17, 14, 23, 14, 14, 13, 9, 7, 9, 14,
];
/** The font's line height: the name's line is this tall. */
export const NAME_LINE = 26;
const DOTS = '...'; // the font has no "…"

export type NameShape = 'blob' | 'teardrop' | 'cloud' | 'hex' | 'squircle' | 'circle';

// Each shape's lowest point, as a fraction of the body's radius (face.c's BODY_LOW).
const BODY_LOW: Record<NameShape, number> = { blob: 0.86, teardrop: 0.98, cloud: 0.68, hex: 0.84, squircle: 0.9, circle: 0.92 };
/** Under the body: the gap between the shape's lowest point and the name's line. */
export const NAME_GAP = 10;
const EDGE = 6; // and from the round screen's edge

export interface NamePlace {
  /**
   * "ring": in the black under the ring, shown all the time (a screen with room there, the AMOLED-1.8).
   * "body": between the body and the round screen's edge (the LCD-1.46), shown only at rest, while
   * neither the ring nor the orbiting dots show.
   */
  under: 'ring' | 'body';
  /** The line's width, in the device's pixels. */
  width: number;
  /** The line's centre, below the face's centre, in the device's pixels. */
  y: number;
  /** The ring's outer radius on this screen, and the screen's height, in pixels. */
  ring: number;
  screenHeight: number;
}

/** Where a device on this board draws the name, for an avatar of this shape. */
export function namePlace(board: string, shape: NameShape): NamePlace {
  const { width, height } = boardScreen(board);
  const fit = Math.min(width, height);
  const px = (n: number) => Math.floor((n * fit + 206) / 412); // a design size on this screen (face.c's PX)
  const ring = px(396);
  const common = { ring: ring / 2, screenHeight: height };
  if (Math.floor((height - ring) / 2) >= NAME_LINE + 10) {
    // Room under the ring for the line and the drift.
    return { under: 'ring', width: px(330), y: Math.floor(ring / 2) + 10 + Math.floor(NAME_LINE / 2), ...common };
  }
  const top = Math.trunc(((BODY_LOW[shape] ?? BODY_LOW.blob) * px(300)) / 2) + NAME_GAP;
  const r = fit / 2 - EDGE;
  const bottom = top + NAME_LINE;
  const across = r > bottom ? Math.trunc(2 * Math.sqrt(r * r - bottom * bottom)) : 0;
  return { under: 'body', width: Math.min(across, px(240)), y: top + Math.floor(NAME_LINE / 2), ...common };
}

function advance(ch: string): number {
  const code = ch.charCodeAt(0);
  return code >= 32 && code <= 126 ? ADVANCE[code - 32] : 0; // the bridge sends nothing else
}

/** The width of a line of text in the device's font, in pixels. */
export function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += advance(ch);
  return width;
}

/**
 * The name as the device shows it in a line this wide: whole, or cut where LVGL cuts it. LVGL breaks
 * the line where it is full, finds the letter under the line's width less three dots (the line is
 * centred, so it starts a little in), and puts "..." in place of it and the rest.
 */
export function cutName(text: string, width: number): string {
  if (textWidth(text) <= width || text.length <= DOTS.length) return text;
  let line = 0;
  for (const ch of text) {
    if (line + advance(ch) > width) break;
    line += advance(ch);
  }
  const at = width - textWidth(DOTS);
  let x = Math.floor((width - line) / 2);
  let i = 0;
  while (i < text.length && at >= x + advance(text[i])) x += advance(text[i++]);
  return text.slice(0, Math.min(i, text.length - DOTS.length)) + DOTS;
}

/**
 * Whether the device shows the name in this state: under the ring all the time; under the body only at
 * rest (idle, attention or offline), as the ring and the orbiting dots pass where it sits otherwise.
 */
export function nameShownIn(place: NamePlace, state: string | undefined): boolean {
  return place.under === 'ring' || !state || state === 'idle' || state === 'attention' || state === 'offline';
}
