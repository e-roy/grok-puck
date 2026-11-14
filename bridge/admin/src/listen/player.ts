// Plays the bridge's speech in the browser: 16-bit PCM (24 kHz from the bridge) as it arrives over the
// WebSocket, each piece scheduled on the AudioContext's own clock right after the one before. There are
// no timers in the way: browsers slow timers down in background tabs, not the audio clock or the
// socket, so a tab in the background keeps playing.

const START_LEAD_S = 0.25; // a clip's first piece starts this far ahead: room for the network's jitter
const LATE_LEAD_S = 0.05; // a piece that arrives after the audio ran dry starts this soon
const FADE_S = 0.015; // Stop fades out this fast, so it doesn't click

interface Clip {
  id: string;
  sampleRate: number;
  gain: GainNode;
  sources: Set<AudioBufferSourceNode>;
  at: number; // when the next piece starts, on the AudioContext's clock (0: nothing scheduled yet)
  ended: boolean; // play.end has arrived
}

export class PcmPlayer {
  /** A clip has played to its end here. */
  onPlayed: (id: string) => void = () => undefined;
  /** Audio started or stopped playing here. */
  onPlaying: (playing: boolean) => void = () => undefined;
  /** The browser paused or resumed this page's sound (a phone locking, another app taking the audio). */
  onRunning: (running: boolean) => void = () => undefined;
  private context: AudioContext | undefined;
  private clip: Clip | undefined;

  /** Call from a click: browsers start a page's sound only then. True once the sound runs. */
  async unlock(): Promise<boolean> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'playback' });
      this.context.addEventListener('statechange', () => this.onRunning(this.running));
    }
    if (this.context.state !== 'running') await this.context.resume().catch(() => undefined);
    return this.running;
  }

  get running(): boolean {
    return this.context?.state === 'running';
  }

  get playing(): boolean {
    return this.clip !== undefined;
  }

  begin(id: string, sampleRate: number): void {
    this.drop(false);
    const context = this.context;
    if (!context) return;
    const gain = context.createGain();
    gain.connect(context.destination);
    this.clip = { id, sampleRate, gain, sources: new Set(), at: 0, ended: false };
    this.onPlaying(true);
  }

  /** A piece of the clip: little-endian 16-bit mono samples. */
  write(data: ArrayBuffer): void {
    const clip = this.clip;
    const context = this.context;
    const samples = data.byteLength >> 1;
    if (!clip || !context || clip.ended || samples === 0) return;
    const view = new DataView(data);
    const buffer = context.createBuffer(1, samples, clip.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(clip.gain);
    const now = context.currentTime;
    if (clip.at === 0) clip.at = now + START_LEAD_S;
    else if (clip.at < now + LATE_LEAD_S) clip.at = now + LATE_LEAD_S; // it ran dry: carry on from just ahead
    source.start(clip.at);
    clip.at += buffer.duration;
    clip.sources.add(source);
    source.onended = () => {
      clip.sources.delete(source);
      this.finishIfDone(clip);
    };
  }

  /** No more pieces for this clip: it is played once what is scheduled has played. */
  end(id: string): void {
    const clip = this.clip;
    if (clip?.id !== id) return;
    clip.ended = true;
    this.finishIfDone(clip);
  }

  /** Stops at once (a quick fade), without reporting the clip as played. */
  stop(): void {
    this.drop(true);
  }

  private finishIfDone(clip: Clip): void {
    if (clip !== this.clip || !clip.ended || clip.sources.size > 0) return;
    this.clip = undefined;
    clip.gain.disconnect();
    this.onPlaying(false);
    this.onPlayed(clip.id);
  }

  private drop(fade: boolean): void {
    const clip = this.clip;
    const context = this.context;
    if (!clip || !context) return;
    this.clip = undefined;
    const now = context.currentTime;
    const until = fade ? now + FADE_S * 3 : now;
    if (fade) clip.gain.gain.setTargetAtTime(0, now, FADE_S);
    for (const source of clip.sources) {
      source.onended = null;
      try {
        source.stop(until);
      } catch {
        // already stopped
      }
    }
    clip.sources.clear();
    // Only tidying up once the fade is over: a slowed-down timer in a background tab does no harm here.
    setTimeout(() => clip.gain.disconnect(), 200);
    this.onPlaying(false);
  }
}
