// The Listen pages: browser tabs that play a device's speech (spec §5.10). Each says which device it
// plays for, and counts as ready only once its Start listening button was pressed, since browsers
// play sound only after a click, and until Stop listening (or the browser pausing its sound). With
// several ready pages for one device, the one started last plays and the others show "playing
// elsewhere". The hub decides what each clip plays on; this keeps track of the pages and talks to them.
import type { FastifyBaseLogger } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { type BridgePageMessage, type PageDevice, type PageRole, type PageState, parsePageMessage } from './protocol.ts';
import type { Store } from './store.ts';

const PING_MS = 25_000; // as for devices: keeps the socket open through proxies that drop idle ones
const MAX_PAGES = 20; // behind the admin login, but a reload loop must not pile them up
const MAX_TIMER_MS = 2_147_483_647;

/** Closed when the page's Cloudflare Access login ends: reloading the page signs in again. */
export const CLOSE_SIGNED_OUT = 4001;
export const CLOSE_TOO_MANY = 4003;

export interface Page {
  socket: WebSocket;
  deviceId: string | null; // the device it plays for
  ready: boolean; // Start listening was pressed (and not Stop listening since)
  rank: number; // the ready page with the highest plays: Start listening takes the next number, a reconnect 0
  alive: boolean;
  timers: NodeJS.Timeout[];
}

/** What the pages need to know about the devices, from the hub. */
export interface PagesView {
  online(deviceId: string): boolean;
  /** What a page shows for this device: its resting state, "speaking", or "listening" while it is held. */
  shown(deviceId: string): PageState;
}

export interface PageEvents {
  played(page: Page, id: string, stopped: boolean): void;
  stop(page: Page): void;
  /** A page is now the one that plays for this device. */
  ready(deviceId: string): void;
  /** The page no longer plays what it was playing: it closed, changed device, or lost its sound. */
  released(page: Page): void;
}

export class ListenPages {
  private readonly store: Store;
  private readonly log: FastifyBaseLogger;
  private readonly view: PagesView;
  private readonly events: PageEvents;
  private readonly pages = new Set<Page>(); // in the order they connected, so a tie goes to the oldest
  private readonly playing = new Map<string, Page>(); // the page that plays for each device, as last announced
  private seq = 0;

  constructor(store: Store, log: FastifyBaseLogger, view: PagesView, events: PageEvents) {
    this.store = store;
    this.log = log;
    this.view = view;
    this.events = events;
  }

  /** A page's socket, already checked (login and Origin). `expires`: when its login ends. */
  accept(socket: WebSocket, expires?: number): void {
    if (this.pages.size >= MAX_PAGES) {
      socket.close(CLOSE_TOO_MANY, 'too many Listen pages are open');
      return;
    }
    const page: Page = { socket, deviceId: null, ready: false, rank: 0, alive: true, timers: [] };
    page.timers.push(
      setInterval(() => {
        if (!page.alive) {
          socket.terminate();
          return;
        }
        page.alive = false;
        socket.ping();
      }, PING_MS),
    );
    if (expires !== undefined) {
      const close = () => socket.close(CLOSE_SIGNED_OUT, 'the sign-in has expired: reload the page');
      page.timers.push(setTimeout(close, Math.min(MAX_TIMER_MS, Math.max(0, expires - Date.now()))));
    }
    this.pages.add(page);
    socket.on('pong', () => {
      page.alive = true;
    });
    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (!isBinary) this.onMessage(page, toText(data));
    });
    socket.on('close', () => this.onClose(page));
    socket.on('error', (err) => this.log.warn({ err }, 'Listen page socket error'));
    this.sendStatus(page);
  }

  /** The page that plays this device's speech: of the ready ones, the one started last. */
  active(deviceId: string): Page | undefined {
    let best: Page | undefined;
    for (const page of this.pages) {
      if (page.deviceId === deviceId && page.ready && (!best || page.rank > best.rank)) best = page;
    }
    return best;
  }

  /** For the admin page: how many pages are open for this device, and whether one is ready. */
  summary(deviceId: string): { open: number; ready: boolean } {
    let open = 0;
    for (const page of this.pages) if (page.deviceId === deviceId) open++;
    return { open, ready: this.active(deviceId) !== undefined };
  }

  send(page: Page, message: BridgePageMessage): void {
    if (page.socket.readyState === page.socket.OPEN) page.socket.send(JSON.stringify(message));
  }

  /** What this device's pages show now. */
  show(deviceId: string, state: PageState): void {
    for (const page of this.pages) if (page.deviceId === deviceId) this.send(page, { type: 'show', state });
  }

  /** Something every page lists changed (a device's name, bot, mute, Speak on, online…). */
  changed(): void {
    for (const page of this.pages) {
      // A forgotten device: its pages play for nothing until they pick another.
      if (page.deviceId && this.store.device(page.deviceId)?.status !== 'approved') this.leave(page, null, page.ready);
      this.sendStatus(page);
    }
  }

  closeAll(): void {
    for (const page of this.pages) page.socket.close(1001, 'bridge stopping');
  }

  private onMessage(page: Page, text: string): void {
    const message = parsePageMessage(text);
    if (!message) {
      this.send(page, { type: 'error', message: 'unrecognised message' });
      return;
    }
    switch (message.type) {
      case 'listen': {
        const known = message.device !== null && this.store.device(message.device)?.status === 'approved';
        this.leave(page, known ? message.device : null, message.ready);
        if (page.deviceId) this.send(page, { type: 'show', state: this.view.shown(page.deviceId) });
        return;
      }
      case 'start':
        page.ready = true;
        page.rank = ++this.seq;
        this.update(page.deviceId);
        return;
      case 'played':
        this.events.played(page, message.id, message.stopped);
        return;
      case 'stop':
        this.events.stop(page);
        return;
    }
  }

  /** Moves a page to another device (or none), ready or not. A page that only reconnected doesn't take over. */
  private leave(page: Page, deviceId: string | null, ready: boolean): void {
    const before = page.deviceId;
    const changed = before !== deviceId;
    if (changed || (page.ready && !ready)) this.events.released(page);
    page.deviceId = deviceId;
    page.ready = ready;
    if (changed) page.rank = 0;
    this.update(before);
    if (changed) this.update(deviceId);
  }

  /** Tells this device's pages their roles, and the hub when another page now plays for it. */
  private update(deviceId: string | null): void {
    if (!deviceId) return;
    for (const page of this.pages) if (page.deviceId === deviceId) this.sendStatus(page);
    const now = this.active(deviceId);
    if (now === this.playing.get(deviceId)) return;
    if (now) this.playing.set(deviceId, now);
    else this.playing.delete(deviceId);
    if (now) this.events.ready(deviceId);
  }

  private onClose(page: Page): void {
    for (const timer of page.timers) clearTimeout(timer);
    this.pages.delete(page);
    this.events.released(page);
    this.update(page.deviceId);
  }

  private sendStatus(page: Page): void {
    const devices = this.devices();
    const device = page.deviceId && devices.some((d) => d.id === page.deviceId) ? page.deviceId : null;
    let role: PageRole = 'off';
    if (device && page.ready) role = this.active(device) === page ? 'here' : 'elsewhere';
    this.send(page, { type: 'status', devices, device, ready: page.ready, role });
  }

  private devices(): PageDevice[] {
    return this.store.state.devices
      .filter((d) => d.status === 'approved')
      .map((d) => {
        const bot = this.store.bot(d.botId);
        return {
          id: d.id,
          name: d.name,
          bot: bot ? { name: bot.name, avatar: bot.avatar } : null,
          online: this.view.online(d.id),
          muted: d.muted,
          speak_on: d.speakOn,
          page_ready: this.active(d.id) !== undefined,
        };
      });
  }
}

function toText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
