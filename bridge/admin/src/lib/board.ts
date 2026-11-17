// A device's board, as its card shows it (spec §4.8). Plain code without imports, so the bridge's tests
// can check it too (bridge/test/board.test.ts).

const BOARDS: Record<string, { short: string; name: string }> = {
  'waveshare-lcd-1.46': { short: 'LCD-1.46', name: 'Waveshare ESP32-S3-Touch-LCD-1.46' },
  'waveshare-amoled-1.8': { short: 'AMOLED-1.8', name: 'Waveshare ESP32-S3-Touch-AMOLED-1.8' },
};

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
