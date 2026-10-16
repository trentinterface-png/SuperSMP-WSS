'use strict';
const http = require('http');
const httpProxy = require('http-proxy');

const upstream = process.env.UPSTREAM_WS || 'ws://sadnode1.sadhost.com:26057';
const port = Number(process.env.PORT || 10000);
if (!/^ws:\/\/[^/]+$/i.test(upstream)) {
  throw new Error('UPSTREAM_WS must be a ws:// hostname:port with no path');
}

let nextConnectionId = 0;
const connections = new WeakMap();
const proxy = httpProxy.createProxyServer({
  target: upstream,
  ws: true,
  changeOrigin: true,
  timeout: 30000,
  proxyTimeout: 30000
});

function log(id, event, detail = '') {
  console.log(`[WS #${id}] ${event}${detail ? ' | ' + detail : ''}`);
}

proxy.on('proxyReqWs', (proxyReq, req, socket) => {
  const id = connections.get(socket)?.id ?? '?';
  log(id, 'UPSTREAM_REQUEST_SENT', `target=${upstream} path=${req.url || '/'}`);
});

proxy.on('open', (proxySocket) => {
  // http-proxy emits this when the upstream WebSocket handshake succeeds.
  console.log('[WS] UPSTREAM_UPGRADED (SadHost accepted WebSocket handshake)');
});

proxy.on('close', () => {
  console.log('[WS] CONNECTION_CLOSED (WebSocket tunnel closed)');
});

proxy.on('error', (err, req, socket) => {
  const id = socket ? (connections.get(socket)?.id ?? '?') : '?';
  console.error(`[WS #${id}] PROXY_ERROR code=${err.code || 'unknown'} message=${err.message} target=${upstream}`);
  if (socket && !socket.destroyed) {
    try {
      if (!socket.headersSent) {
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      } else {
        socket.destroy();
      }
    } catch (_) {
      socket.destroy();
    }
  }
});

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ status: 'running', upstream }) + '\n');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('SuperSMP WSS relay is running. Minecraft players connect using wss:// on this hostname.\n');
});

server.on('upgrade', (req, socket, head) => {
  const id = ++nextConnectionId;
  const started = Date.now();
  connections.set(socket, { id });
  log(id, 'CLIENT_UPGRADE_RECEIVED', `path=${req.url || '/'} host=${req.headers.host || 'unknown'}`);
  socket.on('close', (hadError) => {
    log(id, 'CLIENT_SOCKET_CLOSED', `afterMs=${Date.now() - started} hadError=${hadError}`);
  });
  socket.on('error', (err) => {
    log(id, 'CLIENT_SOCKET_ERROR', `code=${err.code || 'unknown'} message=${err.message}`);
  });
  proxy.ws(req, socket, head, { target: upstream });
});

server.on('error', (err) => console.error('[HTTP] SERVER_ERROR', err));
server.listen(port, '0.0.0.0', () => {
  console.log(`SuperSMP WSS proxy listening on 0.0.0.0:${port}`);
  console.log(`Upstream: ${upstream}`);
  console.log('Diagnostics enabled: CLIENT_UPGRADE_RECEIVED, UPSTREAM_REQUEST_SENT, UPSTREAM_UPGRADED, PROXY_ERROR');
});
