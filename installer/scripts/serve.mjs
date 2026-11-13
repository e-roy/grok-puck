// Serves the packaged page (dist/site) on this computer only, to try it before a release:
//
//   node scripts/serve.mjs [folder] [--port 8790]
//
// http://127.0.0.1 counts as a secure origin, so Web Serial works there as it does over HTTPS.
// Nothing is cached, so a new package shows on the next reload.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const INSTALLER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.bin': 'application/octet-stream',
};

const { values, positionals } = parseArgs({
  options: { port: { type: 'string', default: '8790' } },
  allowPositionals: true,
  strict: true,
});
const root = path.resolve(positionals[0] ?? path.join(INSTALLER, 'dist', 'site'));
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`serve: no index.html in ${root}: run pnpm package --build <firmware build folder> first`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let file;
  try {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found\n');
    return;
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.listen(Number(values.port), '127.0.0.1', () => {
  console.log(`Serving ${path.relative(process.cwd(), root) || '.'} on http://127.0.0.1:${values.port}/ (Ctrl+C to stop)`);
});
