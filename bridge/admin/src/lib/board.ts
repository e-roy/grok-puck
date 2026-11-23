// A device's board, as its card shows it (spec §4.8). Plain code without imports, so the bridge's tests
// can check it too (bridge/test/board.test.ts).

const BOARDS: Record<string, { short: string; name: string; screen: { width: number; height: number } }> = {
  'waveshare-lcd-1.46': { short: 'LCD-1.46', name: 'Waveshare ESP32-S3-Touch-LCD-1.46', screen: { width: 412, height: 412 } },
  'waveshare-amoled-1.8': { short: 'AMOLED-1.8', name: 'Waveshare ESP32-S3-Touch-AMOLED-1.8', screen: { width: 368, height: 448 } },
};

/** The first board, and the only one firmware before 0.6.2 (whose hello names none) ran on. */
const FIRST_BOARD = 'waveshare-lcd-1.46';

/**
 * The badge for the board a device's hello names: a short label and the full name, or null when the
 * hello names none (firmware before 0.6.2). A board this page doesn't know shows its id.
 */
export function boardBadge(board: string): { label: string; title: string } | null {
  const id = board.trim();
  if (!id) return null;
  const known = BOARDS[id];
  return known ? { label: known.short, title: `Board: ${known.name}` } : { label: id, title: `Board: ${id}` };
}

/** The board's screen in pixels; the LCD-1.46's for none (older firmware) or a board this page doesn't know. */
export function boardScreen(board: string): { width: number; height: number } {
  return (BOARDS[board.trim()] ?? BOARDS[FIRST_BOARD]).screen;
}
