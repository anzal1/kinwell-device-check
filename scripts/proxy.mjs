// Token-gated reverse proxy in front of Appium, plus a human-usable live view.
// Usage: TOKEN=... PLATFORM=ios|android SID=<appium session> node proxy.mjs <stopFile>
import http from 'node:http';
import { execFile } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
const { TOKEN, PLATFORM, SID } = process.env;
const stopFile = process.argv[2] || '/tmp/stop';
const prefix = `/${TOKEN}`;
const A = `http://127.0.0.1:4723/session/${SID}`;
const log = (...a) => console.log(new Date().toISOString(), ...a);

const call = async (path, body, method = 'POST') => {
  const r = await fetch(A + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  return r.json().catch(() => ({}));
};
const sh = (cmd, args) => new Promise((ok) => execFile(cmd, args, { encoding: 'buffer', maxBuffer: 30e6 }, (e, out) => ok(e ? null : out)));
const frame = () => PLATFORM === 'android'
  ? sh('adb', ['exec-out', 'screencap', '-p'])
  : sh('sh', ['-c', 'xcrun simctl io booted screenshot --type=png /tmp/frame.png >/dev/null 2>&1 && cat /tmp/frame.png']);

let rect = null; // device units used by Appium taps
const winRect = async () => rect ??= (await call('/window/rect', null, 'GET')).value;
const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

async function tap(fx, fy) {
  if (PLATFORM === 'android') {
    const f = await frame(); if (!f) return 500;
    const { w, h } = pngSize(f);
    await sh('adb', ['shell', 'input', 'tap', String(Math.round(fx * w)), String(Math.round(fy * h))]);
  } else {
    const r = await winRect();
    await call('/execute/sync', { script: 'mobile: tap', args: [{ x: Math.round(fx * r.width), y: Math.round(fy * r.height) }] });
  }
  log('tap', fx.toFixed(3), fy.toFixed(3));
  return 200;
}
async function typeText(t) {
  if (PLATFORM === 'android') {
    await sh('adb', ['shell', 'input', 'text', `'${t.replace(/ /g, '%s').replace(/'/g, "'\\''")}'`]);
  } else {
    await call('/keys', { value: [...t] });
  }
  log('type', t.length, 'chars');
}
async function key(name) {
  if (PLATFORM === 'android') {
    const code = { back: 4, home: 3, enter: 66, delete: 67 }[name];
    await sh('adb', ['shell', 'input', 'keyevent', String(code)]);
  } else if (name === 'home') {
    await call('/execute/sync', { script: 'mobile: pressButton', args: [{ name: 'home' }] });
    await call('/execute/sync', { script: 'mobile: activateApp', args: [{ bundleId: 'com.apple.mobilesafari' }] });
  } else if (name === 'back') {
    const r = await winRect();
    await call('/execute/sync', { script: 'mobile: dragFromToForDuration', args: [{ fromX: 2, fromY: r.height / 2, toX: r.width * 0.8, toY: r.height / 2, duration: 0.2 }] });
  } else if (name === 'enter') {
    await call('/keys', { value: ['\n'] });
  } else if (name === 'delete') {
    await call('/keys', { value: ['\b'] });
  }
  log('key', name);
}
// Best-effort current address bar text (Android shows host+path; iOS Safari often shows the host only).
async function currentUrl() {
  if (PLATFORM === 'ios') {
    // Safari hides the path, so report the page title (changes when the page changes).
    const x = String((await call('/source', null, 'GET')).value || '');
    const t = [...x.matchAll(/<XCUIElementTypeOther[^>]*? label="([^"]+)"[^>]*? height="(\d+)"/g)].find((m) => +m[2] > 400);
    return t ? `title:${t[1]}` : '';
  }
  const e = await call('/element', { using: 'id', value: 'com.android.chrome:id/url_bar' });
  const id = e?.value?.['element-6066-11e4-a52e-4f735466cecf'] || e?.value?.ELEMENT;
  if (!id) return '';
  return String((await call(`/element/${id}/text`, null, 'GET')).value || '');
}

const page = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>device</title>
<style>body{margin:0;background:#111;color:#eee;font:15px system-ui;display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px}
#i{max-height:calc(100vh - 110px);max-width:100%;cursor:pointer;touch-action:manipulation;-webkit-user-select:none}
.bar{display:flex;gap:6px;width:min(100%,520px)}input{flex:1;font-size:16px;padding:8px}button{font-size:15px;padding:8px 12px}</style>
<img id=i alt="device screen">
<div class=bar><button onclick="k('back')">Back</button><button onclick="k('home')">Home</button><button onclick="k('delete')">Del</button><button onclick="k('enter')">Enter</button></div>
<form class=bar id=f><input id=t placeholder="Type into the focused field" autocomplete=off><button>Send</button></form>
<script>
const i=document.getElementById('i');
let busy=false;async function t(){if(!busy){try{const r=await fetch('frame.png?'+Date.now());if(r.ok)i.src=URL.createObjectURL(await r.blob())}catch(e){}}setTimeout(t,500)}t();
i.addEventListener('click',async e=>{const r=i.getBoundingClientRect();const fx=(e.clientX-r.left)/r.width,fy=(e.clientY-r.top)/r.height;await fetch('__tap?fx='+fx+'&fy='+fy,{method:'POST'})});
async function k(n){await fetch('__key?name='+n,{method:'POST'})}
document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();const t=document.getElementById('t');if(t.value){await fetch('__type',{method:'POST',body:t.value});t.value=''}});
</script>`;

http.createServer(async (req, res) => {
  if (!req.url.startsWith(prefix + '/') && req.url !== prefix) { res.writeHead(404).end(); return; }
  const u = new URL(req.url.slice(prefix.length) || '/', 'http://x');
  const path = u.pathname;
  const send = (code, body = '', type = 'text/plain') => res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
  try {
    if (path === '/view') return send(200, page, 'text/html');
    if (path === '/frame.png') { const f = await frame(); return f ? send(200, f, 'image/png') : send(500); }
    if (path === '/__tap') return send(await tap(+u.searchParams.get('fx'), +u.searchParams.get('fy')));
    if (path === '/__key') { await key(u.searchParams.get('name')); return send(200, 'ok'); }
    if (path === '/__type') { let b = ''; for await (const c of req) b += c; await typeText(b); return send(200, 'ok'); }
    if (path === '/__url') return send(200, await currentUrl());
    if (path === '/__stop') { writeFileSync(stopFile, 'stop'); return send(200, 'stopping'); }
  } catch (e) { log('error', String(e)); return send(500, String(e)); }
  const up = http.request({ host: '127.0.0.1', port: 4723, path: req.url.slice(prefix.length) || '/', method: req.method, headers: { ...req.headers, host: '127.0.0.1:4723' } },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => res.writeHead(502).end());
  req.pipe(up);
}).listen(8080, '127.0.0.1');
