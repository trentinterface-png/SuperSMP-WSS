'use strict';
const http = require('http');
const net = require('net');
const dns = require('dns').promises;
const crypto = require('crypto');
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

const targetAddress = new URL(upstream);
let upstreamDiagnostic = {ran:false, dns:{state:'waiting'}, tcp:{state:'waiting'}, handshake:{state:'waiting'}};
let lastCheckAt = 0;
const checkTarget = {hostname:targetAddress.hostname, port:Number(targetAddress.port || 80)};
function tcpConnect(timeoutMs=4500) {
 return new Promise((resolve,reject)=>{
  const sock=net.connect({host:checkTarget.hostname,port:checkTarget.port});
  let done=false;
  function finish(err) {if(done)return;done=true;sock.removeAllListeners('connect');sock.removeAllListeners('error');sock.removeAllListeners('timeout'); if(err){sock.destroy();reject(err)}else resolve(sock)}
  sock.once('connect',()=>finish(null));
  sock.once('error',finish);
  sock.setTimeout(timeoutMs,()=>finish(Object.assign(Error('TCP connect timed out'),{code:'TIMEOUT'})));
 });
}
async function runUpstreamDiagnostic() {
 const result={ran:true,time:new Date().toISOString(),dns:{state:'waiting'},tcp:{state:'waiting'},handshake:{state:'waiting'}};
 upstreamDiagnostic=result;
 try {
  const records=await dns.lookup(checkTarget.hostname,{all:true});
  result.dns={state:'passed',detail:'Resolved '+checkTarget.hostname+' to '+records.map(x=>x.address).join(', ')};
 } catch(e) {
  result.dns={state:'failed',detail:(e.code||'ERROR')+' '+e.message};
  result.tcp={state:'skipped',detail:'DNS failed'};
  result.handshake={state:'skipped',detail:'DNS failed'};
  console.log('[UPSTREAM TEST] DNS FAILED',result.dns.detail);
  return result;
 }
 let sock;
 try {
  sock=await tcpConnect();
  result.tcp={state:'passed',detail:'TCP port '+checkTarget.port+' accepted connection'};
 } catch(e) {
  result.tcp={state:'failed',detail:(e.code||'ERROR')+' '+e.message};
  result.handshake={state:'skipped',detail:'TCP failed'};
  console.log('[UPSTREAM TEST] TCP FAILED',result.tcp.detail);
  return result;
 }
 // This checks the actual upstream's HTTP Upgrade response, without involving Zeus.
 try {
  const key=crypto.randomBytes(16).toString('base64');
  const path=(targetAddress.pathname||'/')+(targetAddress.search||'');
  const request='GET '+path+' HTTP/1.1\r\nHost: '+checkTarget.hostname+':'+checkTarget.port+'\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n';
  const status=await new Promise((resolve,reject)=>{
   let buffer='',settled=false;
   function finish(err,value){if(settled)return;settled=true;sock.destroy();if(err)reject(err);else resolve(value)}
   sock.setTimeout(5000,()=>finish(Object.assign(Error('Handshake timed out'),{code:'TIMEOUT'})));
   sock.on('error',e=>finish(e));
   sock.on('end',()=>finish(Object.assign(Error('Connection closed without HTTP response'),{code:'EARLY_CLOSE'})));
   sock.on('data',buf=>{
    buffer+=buf.toString('latin1');
    if(buffer.includes('\r\n')) finish(null,buffer.split('\r\n')[0].slice(0,180));
    if(buffer.length>4096)finish(Error('No HTTP status line'));
   });
   sock.write(request);
  });
  const match=status.match(/^HTTP\/1\.[01] (\d{3})/);
  const pass=match&&Number(match[1])===101;
  result.handshake={state:pass?'passed':'failed',detail:'Response: '+status};
 } catch(e) {
  result.handshake={state:'failed',detail:(e.code||'ERROR')+' '+e.message};
 }
 console.log('[UPSTREAM TEST] DNS='+result.dns.state+' TCP='+result.tcp.state+' HANDSHAKE='+result.handshake.state+' '+result.handshake.detail);
 return result;
}

const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SuperSMP WSS Diagnostics</title>
<style>body{font:16px system-ui;background:#0c1629;color:#eef5ff;max-width:720px;margin:20px auto;padding:16px}h1{font-size:24px}section{background:#1a2b45;border-radius:12px;padding:18px;margin:14px 0}button{padding:13px;background:#3479ff;color:white;border:0;border-radius:9px;font-weight:bold}.passed{color:#68e5af}.failed{color:#ff828b}.sent{color:#ffd789}.waiting{color:#b7c5d9}.state{font-weight:bold}small{color:#c2cce0}#history{white-space:pre-wrap;font-size:13px}</style>
<h1>SuperSMP — Live Connection Checks</h1><p>Test from this device, or connect using Zeus. Results refresh every two seconds.</p>
<button id="test">Test WSS connection now</button><p id="local">No test started on this device.</p>
<section><b>1. ZEUS TO NORTHFLANK</b><p class="state waiting" id="client">Waiting</p><small>Did the incoming WebSocket reach Northflank?</small></section>
<section><b>2. NORTHFLANK TO SADHOST</b><p class="state waiting" id="sadhostRequest">Waiting</p><small>Was the upstream handshake request sent? This alone is not proof of acceptance.</small></section>
<section><b>3. SADHOST HANDSHAKE RESPONSE</b><p class="state waiting" id="sadhostHandshake">Waiting</p><small>Did SadHost return a successful WebSocket upgrade?</small></section>
<section><b>DIRECT SADHOST CHECKS</b><p>Runs separate tests from Northflank. This helps distinguish DNS, TCP, and WebSocket handshake failures.</p><button id="upTest">Test SadHost directly</button><p id="upStatus">Not tested yet.</p><div id="upResults">Waiting for test.</div></section>
<section><b>Recent attempts</b><p id="history">No attempts yet.</p></section>
<script>
const keys=['client','sadhostRequest','sadhostHandshake'];
async function refresh(){try{const d=await (await fetch('/diagnostics.json',{cache:'no-store'})).json();const x=d.attempts[0];for(const k of keys){const el=document.getElementById(k),v=x?.[k];el.className='state '+(v?.state||'waiting');el.textContent=v?v.state.toUpperCase()+' — '+v.detail:'Waiting for test';}document.getElementById('history').textContent=d.attempts.slice(0,8).map(a=>'#'+a.id+' '+a.time+' — '+keys.map(k=>k+': '+a[k].state).join(' / ')).join(String.fromCharCode(10))||'No attempts yet.';}catch(e){document.getElementById('history').textContent='Cannot load results: '+e.message}}
document.getElementById('test').onclick=()=>{const out=document.getElementById('local');out.textContent='Testing…';let ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/');let t=setTimeout(()=>{out.textContent='Timed out';ws.close()},10000);ws.onopen=()=>{clearTimeout(t);out.textContent='CONNECTED: WebSocket opened successfully';ws.close()};ws.onerror=()=>{clearTimeout(t);out.textContent='Connection failed; see stages below'};ws.onclose=()=>refresh()};
async function checkUpstream(){const status=document.getElementById('upStatus');status.textContent='Testing SadHost from Northflank…';try{const response=await fetch('/check-upstream',{method:'POST'});const data=await response.json();if(!response.ok){status.textContent=data.error||'Test unavailable';return;}status.textContent='Test finished';showUpstream(data)}catch(e){status.textContent='Request failed: '+e.message}}
function showUpstream(d){document.getElementById('upResults').innerHTML=['dns','tcp','handshake'].map((k,i)=>{const x=d[k]||{state:'waiting',detail:''};const names=['A. DNS resolution','B. TCP port connection','C. Direct WebSocket handshake'];return '<p><b>'+names[i]+'</b>: <span class="'+x.state+'">'+x.state.toUpperCase()+'</span> — '+String(x.detail||'').replace(/</g,'&lt;')+'</p>'}).join('')}
document.getElementById('upTest').onclick=checkUpstream;
fetch('/diagnostics.json').then(r=>r.json()).then(d=>{if(d.upstreamDiagnostic?.ran){document.getElementById('upStatus').textContent='Last tested '+d.upstreamDiagnostic.time;showUpstream(d.upstreamDiagnostic)}}).catch(()=>{});
refresh();setInterval(refresh,2000);
</script></html>`;
const server=http.createServer((req,res)=>{
 if(req.url==='/check-upstream' && req.method==='POST'){
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(Date.now()-lastCheckAt<10000){res.statusCode=429;res.end(JSON.stringify({error:'Wait 10 seconds between checks'}));return}
  lastCheckAt=Date.now();runUpstreamDiagnostic().then(data=>res.end(JSON.stringify(data))).catch(e=>{res.statusCode=500;res.end(JSON.stringify({error:e.message}))});return;
 }
 if(req.url==='/diagnostics'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(page);return}
 if(req.url==='/diagnostics.json'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({running:true,upstream,attempts,upstreamDiagnostic}));return}
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
