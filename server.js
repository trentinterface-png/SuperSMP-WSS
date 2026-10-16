'use strict';
const http = require('http');
const proxyServer = require('http-proxy');
const upstream = process.env.UPSTREAM_WS || 'ws://sadnode1.sadhost.com:26057';
const port = Number(process.env.PORT || 10000);
if (!/^ws:\/\/[^/]+$/i.test(upstream)) throw Error('Expected ws://host:port');
const proxy = proxyServer.createProxyServer({target:upstream,ws:true,changeOrigin:true,timeout:15000,proxyTimeout:15000});
let count = 0;
const socketInfo = new WeakMap(), attempts = [];
function set(item, name, state, detail) {
 item[name]={state,detail,time:new Date().toISOString()};
 console.log('[TEST #'+item.id+'] '+name.toUpperCase()+' '+state.toUpperCase()+' | '+detail);
}
proxy.on('proxyReqWs',(proxyReq,req,socket)=>{
 const item=socketInfo.get(socket);
 if(item) set(item,'sadhostRequest','sent','Upgrade request sent toward '+upstream+'; acceptance not yet confirmed');
});
proxy.on('open',()=>{
 const item=attempts.find(x=>x.sadhostRequest?.state==='sent'&&x.sadhostHandshake?.state==='waiting');
 if(item) set(item,'sadhostHandshake','passed','SadHost accepted HTTP 101 WebSocket upgrade');
 else console.log('[WS] UPSTREAM_UPGRADED');
});
proxy.on('error',(err,req,socket)=>{
 const item=socket&&socketInfo.get(socket);
 const detail=(err.code||'ERROR')+': '+err.message;
 if(item) {
  if(item.sadhostRequest.state==='waiting') set(item,'sadhostRequest','failed',detail);
  set(item,'sadhostHandshake','failed',detail);
 }
 console.error('[WS] PROXY_ERROR '+detail+' upstream='+upstream);
 if(socket&&!socket.destroyed) {try{socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')}catch(e){socket.destroy()}}
});
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SuperSMP WSS Diagnostics</title>
<style>body{font:16px system-ui;background:#0c1629;color:#eef5ff;max-width:720px;margin:20px auto;padding:16px}h1{font-size:24px}section{background:#1a2b45;border-radius:12px;padding:18px;margin:14px 0}button{padding:13px;background:#3479ff;color:white;border:0;border-radius:9px;font-weight:bold}.passed{color:#68e5af}.failed{color:#ff828b}.sent{color:#ffd789}.waiting{color:#b7c5d9}.state{font-weight:bold}small{color:#c2cce0}#history{white-space:pre-wrap;font-size:13px}</style>
<h1>SuperSMP — Live Connection Checks</h1><p>Test from this device, or connect using Zeus. Results refresh every two seconds.</p>
<button id="test">Test WSS connection now</button><p id="local">No test started on this device.</p>
<section><b>1. ZEUS TO NORTHFLANK</b><p class="state waiting" id="client">Waiting</p><small>Did the incoming WebSocket reach Northflank?</small></section>
<section><b>2. NORTHFLANK TO SADHOST</b><p class="state waiting" id="sadhostRequest">Waiting</p><small>Was the upstream handshake request sent? This alone is not proof of acceptance.</small></section>
<section><b>3. SADHOST HANDSHAKE RESPONSE</b><p class="state waiting" id="sadhostHandshake">Waiting</p><small>Did SadHost return a successful WebSocket upgrade?</small></section>
<section><b>Recent attempts</b><p id="history">No attempts yet.</p></section>
<script>
const keys=['client','sadhostRequest','sadhostHandshake'];
async function refresh(){try{const d=await (await fetch('/diagnostics.json',{cache:'no-store'})).json();const x=d.attempts[0];for(const k of keys){const el=document.getElementById(k),v=x?.[k];el.className='state '+(v?.state||'waiting');el.textContent=v?v.state.toUpperCase()+' — '+v.detail:'Waiting for test';}document.getElementById('history').textContent=d.attempts.slice(0,8).map(a=>'#'+a.id+' '+a.time+' — '+keys.map(k=>k+': '+a[k].state).join(' / ')).join('\n')||'No attempts yet.';}catch(e){document.getElementById('history').textContent='Cannot load results: '+e.message}}
document.getElementById('test').onclick=()=>{const out=document.getElementById('local');out.textContent='Testing…';let ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/');let t=setTimeout(()=>{out.textContent='Timed out';ws.close()},10000);ws.onopen=()=>{clearTimeout(t);out.textContent='CONNECTED: WebSocket opened successfully';ws.close()};ws.onerror=()=>{clearTimeout(t);out.textContent='Connection failed; see stages below'};ws.onclose=()=>refresh()};
refresh();setInterval(refresh,2000);
</script></html>`;
const server=http.createServer((req,res)=>{
 if(req.url==='/diagnostics'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(page);return}
 if(req.url==='/diagnostics.json'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({running:true,upstream,attempts}));return}
 if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({status:'running',upstream}));return}
 res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
 res.end('SuperSMP WSS relay is running. Open /diagnostics for the three-stage test.\n');
});
server.on('upgrade',(req,socket,head)=>{
 const item={id:++count,time:new Date().toISOString()};
 item.client={state:'waiting',detail:'Awaiting client'};
 item.sadhostRequest={state:'waiting',detail:'Not yet sent'};
 item.sadhostHandshake={state:'waiting',detail:'Not yet accepted'};
 attempts.unshift(item);if(attempts.length>25)attempts.pop();
 socketInfo.set(socket,item);
 set(item,'client','passed','Zeus or browser reached Northflank via WebSocket');
 socket.on('close',()=>console.log('[TEST #'+item.id+'] CLIENT_SOCKET_CLOSED'));
 socket.on('error',e=>console.log('[TEST #'+item.id+'] CLIENT_SOCKET_ERROR '+e.message));
 proxy.ws(req,socket,head,{target:upstream});
});
server.on('error',e=>console.error('[HTTP] SERVER_ERROR',e));
server.listen(port,'0.0.0.0',()=>console.log('SuperSMP three-stage diagnostics listening on :'+port+' upstream='+upstream));
