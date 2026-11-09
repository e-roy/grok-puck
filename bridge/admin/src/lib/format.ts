// Small formatting helpers shared by the sections.

/** A time: just the clock today, the date as well otherwise. */
export function when(iso: string | undefined): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return today ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : date.toLocaleString();
}

/** "just now", "5 min ago", "3 h ago", or the date. */
export function ago(iso: string | undefined): string {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function seconds(ms: number | undefined): string {
  return ms === undefined ? '' : `${(ms / 1000).toFixed(1)} s`;
}

export const enc = encodeURIComponent;
