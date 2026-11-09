// Entry point: `pnpm start` (or `node src/main.ts`).
import { loadConfig } from './config.ts';
import { startBridge } from './server.ts';

const config = loadConfig();
const bridge = await startBridge(config);
console.log(`desk bridge: devices and MCP on port ${bridge.publicPort}, admin page on http://${config.adminHost}:${bridge.adminPort}`);

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void bridge.close().then(() => process.exit(0));
  });
}
