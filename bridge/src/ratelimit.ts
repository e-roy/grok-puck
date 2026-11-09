// A sliding one-hour window: at most `limit` events in any hour.

const HOUR_MS = 3_600_000;

export class RateLimit {
  readonly limit: number;
  private readonly times: number[] = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  /** Counts one event; false when the hour's limit is already reached. */
  take(now = Date.now()): boolean {
    while (this.times.length && now - this.times[0] >= HOUR_MS) this.times.shift();
    if (this.times.length >= this.limit) return false;
    this.times.push(now);
    return true;
  }
}
