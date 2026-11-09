// Starts the bridge: the public server (devices and Grok Bot) and the admin server, on separate ports.
import type { AddressInfo } from 'node:net';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { registerAdmin } from './admin.ts';
import type { Config } from './config.ts';
import { Desk } from './desk.ts';
import { DeviceHub } from './hub.ts';
import { handleMcp, McpActivity } from './mcp.ts';
import { Store } from './store.ts';

export interface Bridge {
  publicPort: number;
  adminPort: number;
  store: Store;
  close(): Promise<void>;
}

export async function startBridge(config: Config): Promise<Bridge> {
  const app = Fastify({ logger: { level: config.logLevel }, bodyLimit: 1_048_576, forceCloseConnections: true });
  const store = new Store(config.dataDir);
  // The hub reports to the desk, and the desk drives the hub.
  let desk!: Desk;
  const hub = new DeviceHub(store, app.log, {
    utterance: (device, pcm) => void desk.onUtterance(device, pcm),
    connected: (device) => desk.onConnected(device),
    quiet: (device) => desk.onQuiet(device),
  });
  desk = new Desk(store, hub, app.log);
  const activity = new McpActivity();

  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/device', { websocket: true }, (socket) => hub.accept(socket));
  app.all('/mcp', (req, reply) => handleMcp(req, reply, { store, desk, activity }));
  await app.listen({ host: config.publicHost, port: config.publicPort });
  const publicPort = (app.server.address() as AddressInfo).port;

  const admin = Fastify({ loggerInstance: app.log, forceCloseConnections: true });
  await registerAdmin(admin, { config, store, hub, desk, activity, publicPort });
  await admin.listen({ host: config.adminHost, port: config.adminPort });
  const adminPort = (admin.server.address() as AddressInfo).port;

  return {
    publicPort,
    adminPort,
    store,
    async close() {
      hub.closeAll();
      desk.close();
      await admin.close();
      await app.close();
      store.flush();
    },
  };
}
