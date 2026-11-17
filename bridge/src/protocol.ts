// The device link: one WebSocket per device, JSON text messages plus binary audio frames.
//
// Device → bridge
//   hello          first message: who it is, its key once approved, its Wi-Fi (firmware 0.6.0+),
//                  what it can do beyond 0.6.0 (features: "speaking", firmware 0.6.1+), and its board
//                  with that board's hardware (board: "waveshare-amoled-1.8"; features: "touch",
//                  "microphone", "speaker"; firmware 0.6.2+)
//   listen.start   a hold began: the microphone opened; binary frames (16 kHz PCM) follow
//   listen.end     the finger lifted: send what was heard          listen.cancel   drop it
//   played         a clip finished (or was stopped on the device)
//   stop           the user touched the screen to stop speech
//   state          what the device shows (informational)
//   wifi           its saved network names, the one in use and its signal, whether setup is open
//                  (when any of these change). Never a password.
//
// Bridge → device
//   pending        known, waiting for approval in the admin page
//   welcome        approved: the device key to store and send in every later hello
//   config         name, bot avatar, volume, mute, longest message
//   show           the state to display (idle, thinking, working, waiting, error), and "speaking"
//                  while a Listen page plays its speech (only to devices whose hello lists "speaking")
//   play.start     a clip begins; binary frames (24 kHz PCM) follow, then play.end
//   stop           stop playing now
//   wifi.setup     open the setup network for 10 minutes and stay online (from the admin page)
//   wifi.forget_network   forget one saved network, by name (from the admin page)
//   wifi.forget    forget every saved network and restart into setup (from the admin page)
//   error          something the device should know about (also logged by the bridge)
//
// The Listen page (a browser tab that plays a device's speech, on the admin port at /listen/ws)
// Page → bridge
//   listen         which device it plays for; ready: Start listening was pressed before (a reconnect).
//                  ready: false after Stop listening (or while the browser pauses its sound): the device speaks
//   start          Start listening (or Play here) was pressed: it plays from now on, the others don't
//   played         a clip finished playing there          stop     its Stop button: stop speech everywhere
// Bridge → page
//   status         the devices to pick from, the one it plays for, and its role (off, here, elsewhere)
//   show           what the device shows, "speaking" while the desk speaks anywhere, or "listening"
//                  while the owner holds the device (never sent to the device: it shows that itself)
//   play.start, binary frames (24 kHz PCM), play.end, stop: as for a device
//   error
import { z } from 'zod';
import type { Avatar, SpeakOn, Timings } from './store.ts';

/** The states the desk shows between clips: what the bot is doing. */
export const DISPLAY_STATES = ['idle', 'thinking', 'working', 'waiting', 'error'] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];
/** What a device or a Listen page is told to show: a resting state, or "speaking". */
export type ShownState = DisplayState | 'speaking';
/**
 * What a Listen page (and the admin page) shows: what the device is told, or "listening" while the
 * owner holds it. The device is never told "listening": it shows its own listening face.
 */
export type PageState = ShownState | 'listening';

/** In a device's hello: it can show "speaking" on request while its speech plays elsewhere. */
export const FEATURE_SPEAKING = 'speaking';

export const DEVICE_ID = /^[A-Za-z0-9:_-]{1,64}$/;
/** A board's id, as the firmware names it: "waveshare-amoled-1.8". */
export const BOARD_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** A device remembers at most this many Wi-Fi networks. */
export const MAX_NETWORKS = 5;
// A Wi-Fi name is at most 32 bytes; in characters that is never more.
const NetworkName = z.string().min(1).max(32);

/** What a device says about its Wi-Fi: names only, never a password. */
export const WifiReport = z.object({
  saved: z.array(NetworkName).max(MAX_NETWORKS), // most recently joined first
  current: NetworkName.nullable().default(null),
  rssi: z.number().int().min(-128).max(127).nullable().default(null), // dBm
  setup: z.boolean().default(false), // its setup network is open
});
export type WifiReport = z.infer<typeof WifiReport>;

export const DeviceMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    device_id: z.string().regex(DEVICE_ID),
    firmware: z.string().max(64).default(''),
    key: z.string().max(128).optional(),
    // Older firmware sends none. A report that doesn't fit is dropped, so it never stops a hello.
    wifi: WifiReport.optional().catch(undefined),
    // Firmware 0.6.1 and later: what it can do beyond 0.6.0 ("speaking"); from 0.6.2, its board's
    // hardware too ("touch", "microphone", "speaker"). Unknown names are kept.
    features: z.array(z.string().max(32)).max(16).optional().catch(undefined),
    // Firmware 0.6.2 and later: the board it runs on (spec §4.8). One that doesn't fit is dropped.
    board: z.string().regex(BOARD_ID).optional().catch(undefined),
  }),
  WifiReport.extend({ type: z.literal('wifi') }),
  z.object({ type: z.literal('listen.start'), sample_rate: z.literal(16_000) }),
  z.object({ type: z.literal('listen.end') }),
  z.object({ type: z.literal('listen.cancel') }),
  z.object({ type: z.literal('played'), id: z.string().max(64), stopped: z.boolean().default(false) }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('state'), state: z.string().max(32) }),
]);
export type DeviceMessage = z.infer<typeof DeviceMessage>;
export type Hello = Extract<DeviceMessage, { type: 'hello' }>;

export interface DeviceConfig {
  type: 'config';
  name: string;
  bot: { name: string; avatar: Avatar } | null;
  volume: number;
  muted: boolean;
  timings: Timings;
}

export type BridgeMessage =
  | { type: 'pending'; device_id: string }
  | { type: 'welcome'; key: string }
  | DeviceConfig
  | { type: 'show'; state: ShownState }
  | { type: 'play.start'; id: string; sample_rate: number; format: 'pcm_s16le'; kind: 'speech' | 'tone' }
  | { type: 'play.end'; id: string }
  | { type: 'stop' }
  | { type: 'wifi.setup' }
  | { type: 'wifi.forget_network'; ssid: string }
  | { type: 'wifi.forget' }
  | { type: 'error'; message: string };

export function parseDeviceMessage(text: string): DeviceMessage | undefined {
  return parse(DeviceMessage, text);
}

// ---- the Listen page ----

export const PageMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('listen'), device: z.string().max(64).nullable().default(null), ready: z.boolean().default(false) }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('played'), id: z.string().max(64), stopped: z.boolean().default(false) }),
  z.object({ type: z.literal('stop') }),
]);
export type PageMessage = z.infer<typeof PageMessage>;

/** A device as a Listen page sees it, to pick it and to draw its bot. */
export interface PageDevice {
  id: string;
  name: string;
  bot: { name: string; avatar: Avatar } | null;
  online: boolean;
  muted: boolean;
  speak_on: SpeakOn;
  page_ready: boolean; // a Listen page (this one or another) is ready to play its speech
}

/** off: not started yet · here: it plays this device's speech · elsewhere: a page started later does. */
export type PageRole = 'off' | 'here' | 'elsewhere';

export type BridgePageMessage =
  | { type: 'status'; devices: PageDevice[]; device: string | null; ready: boolean; role: PageRole }
  | { type: 'show'; state: PageState }
  | Extract<BridgeMessage, { type: 'play.start' | 'play.end' | 'stop' | 'error' }>;

export function parsePageMessage(text: string): PageMessage | undefined {
  return parse(PageMessage, text);
}

function parse<T>(schema: z.ZodType<T>, text: string): T | undefined {
  try {
    const result = schema.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
