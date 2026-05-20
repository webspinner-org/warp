// Loom entry — replacement for SvelteKit adapter-node's build/index.js.
//
// Wraps the compiled handler with CORS headers on routes that the
// standalone-download .html needs to reach cross-origin:
//
//   /_app/immutable/*  — SvelteKit's content-addressed chunks the
//                        standalone bootstrapper dynamically imports.
//                        SvelteKit serves these BEFORE hooks.server.ts
//                        runs, so hook-level CORS never fires for them.
//   /app/*             — bundle / unlock / version / standalone reads
//                        and writes the standalone may issue at runtime.
//
// Immutable assets are content-addressed; opening them up is safe.
// /app/* endpoints already gate on the install_token in the URL.
//
// deploy-loom copies this file over build/index.js after `pnpm build`
// so the launchd plist needs no change. SvelteKit re-generates
// build/index.js on every build; the post-build copy is what makes
// the wrapping stick.

import http from 'node:http';
import { handler } from './handler.js';

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT || '3000', 10);

function needsCors(url) {
  return url.startsWith('/_app/immutable/') || url.startsWith('/app/');
}

const server = http.createServer((req, res) => {
  const url = req.url || '';
  if (needsCors(url)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
  }
  handler(req, res, () => {
    res.statusCode = 404;
    res.end('Not Found');
  });
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Loom listening on http://${HOST}:${PORT} (CORS-wrapped)`);
});

// Match adapter-node's graceful-shutdown behaviour — close listening
// on SIGTERM/SIGINT so launchd's bootout doesn't leave zombie sockets.
function shutdown(sig) {
  // eslint-disable-next-line no-console
  console.log(`Loom shutting down on ${sig}`);
  server.close(() => process.exit(0));
  // Hard kill if close() doesn't finish in 10s.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
