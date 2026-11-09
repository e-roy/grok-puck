// A piece of audio that is still arriving (TTS streams it) and can be read by several devices at once.

export class Clip {
  readonly sampleRate: number;
  /** Resolves when the clip ends, rejects if its source fails. */
  readonly settled: Promise<void>;
  private readonly chunks: Buffer[] = [];
  private finished = false;
  private failure: Error | undefined;
  private waiters: Array<() => void> = [];
  private resolveSettled!: () => void;
  private rejectSettled!: (err: Error) => void;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.settled = new Promise<void>((resolve, reject) => {
      this.resolveSettled = resolve;
      this.rejectSettled = reject;
    });
    this.settled.catch(() => undefined); // readers see the failure through read()
  }

  /** A clip whose audio is all here already. */
  static of(pcm: Buffer, sampleRate: number): Clip {
    const clip = new Clip(sampleRate);
    clip.push(pcm);
    clip.end();
    return clip;
  }

  /** A clip that can't be made, e.g. because no voice is set. */
  static failed(err: Error, sampleRate: number): Clip {
    const clip = new Clip(sampleRate);
    clip.fail(err);
    return clip;
  }

  /** A clip filled in the background from a stream. */
  static from(source: AsyncIterable<Buffer>, sampleRate: number): Clip {
    const clip = new Clip(sampleRate);
    void (async () => {
      try {
        for await (const chunk of source) clip.push(chunk);
        clip.end();
      } catch (err) {
        clip.fail(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return clip;
  }

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.wake();
  }

  end(): void {
    this.finished = true;
    this.resolveSettled();
    this.wake();
  }

  fail(err: Error): void {
    this.failure = err;
    this.rejectSettled(err);
    this.wake();
  }

  /** Every chunk from the start, waiting for new ones until the clip ends. */
  async *read(): AsyncGenerator<Buffer> {
    let next = 0;
    for (;;) {
      while (next < this.chunks.length) yield this.chunks[next++];
      if (this.failure) throw this.failure;
      if (this.finished) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  /** All of the audio, once the clip has ended. */
  async all(): Promise<Buffer> {
    const parts: Buffer[] = [];
    for await (const chunk of this.read()) parts.push(chunk);
    return Buffer.concat(parts);
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }
}
