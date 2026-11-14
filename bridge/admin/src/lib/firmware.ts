// A device's firmware, as its card shows it. Plain code without imports, so the bridge's tests can
// check it too (bridge/test/firmware.test.ts).

/**
 * The version in the firmware string a device's hello gives: "desk-display/0.6.1" → "0.6.1". A
 * string without a "/" is taken as the version; "unknown" when there is none.
 */
export function firmwareVersion(firmware: string): string {
  const text = firmware.trim();
  return text.slice(text.lastIndexOf('/') + 1).trim() || 'unknown';
}
