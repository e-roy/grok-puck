// The device link: one WebSocket per device, JSON text messages plus binary audio frames.
//
// Device → bridge
//   hello          first message: who it is, its key once approved, and its Wi-Fi (firmware 0.6.0+)
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
//   show           the state to display (idle, thinking, working, waiting, error)
//   play.start     a clip begins; binary frames (24 kHz PCM) follow, then play.end
//   stop           stop playing now
//   wifi.setup     open the setup network for 10 minutes and stay online (from the admin page)
//   wifi.forget_network   forget one saved network, by name (from the admin page)
//   wifi.forget    forget every saved network and restart into setup (from the admin page)
//   error          something the device should know about (also logged by the bridge)
import { z } from 'zod';
import type { Avatar, Timings } from './store.ts';

export const DISPLAY_STATES = ['idle', 'thinking', 'working', 'waiting', 'error'] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];

export const DEVICE_ID = /^[A-Za-z0-9:_-]{1,64}$/;

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
  | { type: 'show'; state: DisplayState }
  | { type: 'play.start'; id: string; sample_rate: number; format: 'pcm_s16le'; kind: 'speech' | 'tone' }
  | { type: 'play.end'; id: string }
  | { type: 'stop' }
  | { type: 'wifi.setup' }
  | { type: 'wifi.forget_network'; ssid: string }
  | { type: 'wifi.forget' }
  | { type: 'error'; message: string };

export function parseDeviceMessage(text: string): DeviceMessage | undefined {
  try {
    const result = DeviceMessage.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
