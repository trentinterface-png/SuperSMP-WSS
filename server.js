'use strict';
const http = require('http');
const httpProxy = require('http-proxy');

// Incoming TLS (wss://) is terminated by Render.
const upstream = process.env.UPSTREAM_WS || 'ws://sadnode1.sadhost.com:26057';
const port = Number(process.env.PORT || 10000);
if (!/^ws:\/\/[^/]+$/i.test(upstream)) {
  throw new Error('UPSTREAM_WS must be a ws:// hostname:port with no path');
}
const proxy = httpProxy.createProxyServer({
  target: upstream,
  ws: true,
  changeOrigin: true,
  secure: true,
  timeout: 30000,
  proxyTimeout: 30000
});
proxy.on('error', (err, req, socket) => {
  console.error('WebSocket proxy error:', err.message);
  if (socket && !socket.destroyed) {
    try { socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); }
    catch (_) { socket.destroy(); }
  }
});
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('SuperSMP WSS relay is running. Minecraft players connect using wss:// on this hostname.\n');
});
server.on('upgrade', (req, socket, head) => {
  proxy.ws(req, socket, head, { target: upstream });
});
server.listen(port, '0.0.0.0', () => {
  console.log(`SuperSMP WSS proxy listening on 0.0.0.0:${port}`);
  console.log(`Upstream: ${upstream}`);
});