// Per-browser conveniences kept in localStorage (the last sentences tried on a device). Storage can be
// missing or refuse (private windows), so every access is guarded and the page works without it.

export function readList(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Puts `item` first, without duplicates, keeping at most `max`. */
export function pushList(key: string, item: string, max = 5): string[] {
  const list = [item, ...readList(key).filter((v) => v !== item)].slice(0, max);
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // not kept; fine
  }
  return list;
}
