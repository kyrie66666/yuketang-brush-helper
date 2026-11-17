#!/usr/bin/env node
// 多窗口并发刷课（绕开浏览器对后台标签页的节流）
//
//   node tools/brush.mjs --course 33645148 --windows 4 --minutes 30
//
// 原理：浏览器会节流「后台标签页」（视频 duration 恒为 0、播不动），但独立的**可见窗口**
// 不算后台。所以这里开 N 个平铺窗口，每个窗口注入 userscript（模拟 Tampermonkey 的
// @run-at document-start），由脚本内部的 localStorage 认领队列保证互不重复。
//
// 前置：浏览器需带以下参数启动
//   --remote-debugging-port=9222 --user-data-dir=<非默认目录>
//   --disable-background-timer-throttling
//   --disable-backgrounding-occluded-windows
//   --disable-renderer-backgrounding
//   --disable-features=CalculateNativeWinOcclusion
//   --autoplay-policy=no-user-gesture-required
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT, sleep, listTabs, attach, browserInfo, ok, fail } from './cdp.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = '') => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};

const PORT = Number(opt('port', String(DEFAULT_PORT)));
const COURSE = opt('course', '');
const WINDOWS = Number(opt('windows', '4'));
const MINUTES = Number(opt('minutes', '30'));
const MODE = opt('mode', 'all'); // all | fast（fast 只刷图文/讨论，视频留给串行）
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = opt('script', path.join(HERE, '..', 'yuketang.user.js'));

if (!COURSE) fail('需要 --course <classroomId>');
if (!fs.existsSync(SCRIPT)) fail(`找不到脚本: ${SCRIPT}`);

const ENTRY = `https://www.yuketang.cn/v2/web/studentLog/${COURSE}?classroom_id=${COURSE}`;

const PRELUDE = `
try { window.opener = null; } catch (e) {}
window.unsafeWindow = window;
window.GM_xmlhttpRequest = function (o) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => { ctrl.abort(); o.ontimeout && o.ontimeout(); }, o.timeout || 60000);
  fetch(o.url, { method: o.method || 'GET', headers: o.headers || {}, body: o.data, signal: ctrl.signal })
    .then(async r => { clearTimeout(timer); const text = await r.text(); o.onload && o.onload({ status: r.status, responseText: text }); })
    .catch(e => { clearTimeout(timer); o.onerror && o.onerror({ error: String(e) }); });
};
`;

const SEED = `
(() => {
  let tid = sessionStorage.getItem('ykt_tab_id');
  if (!tid) { tid = 'win-' + Math.random().toString(36).slice(2, 9); sessionStorage.setItem('ykt_tab_id', tid); }
  localStorage.setItem('ykt_feature_conf', JSON.stringify({ autoAI: false, autoComment: true }));
  localStorage.setItem('ykt_mode', ${JSON.stringify(MODE)});
  localStorage.setItem('ykt_pending_auto_start:' + tid, JSON.stringify({
    classroomId: '${COURSE}', returnUrl: ${JSON.stringify(ENTRY)}, ts: Date.now()
  }));
  return tid;
})()
`;

const READ = `(() => {
  const f = document.getElementById('ykt-helper-iframe');
  const info = f && f.contentDocument && f.contentDocument.getElementById('info');
  const v = document.querySelector('video, audio');
  let claims = 0;
  try { const a = JSON.parse(localStorage.getItem('ykt_claim_queue') || '{}'); claims = Object.keys(a['${COURSE}'] || {}).length; } catch (e) {}
  return JSON.stringify({
    path: location.pathname.replace('/ai-workspace/lms-graph/${COURSE}/', 'AI:').replace('/v2/web/studentLog/${COURSE}', 'LIST'),
    media: v ? Math.round(v.currentTime || 0) + '/' + Math.round(v.duration || 0) : '-',
    claims,
    last: info ? info.innerText.split('\\n').slice(-1)[0] : '(无面板)'
  });
})()`;

// 浏览器级会话（用于开新窗口 + 摆放位置）
const info = await browserInfo(PORT).catch(() => null);
if (!info) fail(`连不上 CDP ${PORT}，请确认浏览器已用 --remote-debugging-port 启动`);

const ws = new WebSocket(info.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
let bseq = 0;
const bpend = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id === undefined) return;
  const p = bpend.get(m.id);
  if (!p) return;
  bpend.delete(m.id);
  m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
});
const bsend = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++bseq;
  bpend.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (bpend.delete(id)) reject(new Error('timeout ' + method)); }, 20000);
});

// 屏幕尺寸：从任意已有页面读
let screenW = 1920, screenH = 1080;
const anyPage = (await listTabs(PORT)).find(t => t.type === 'page' && t.url.startsWith('http'));
if (anyPage) {
  const c = await attach(anyPage, { enablePage: false });
  const s = await c.evaluate('JSON.stringify({w:screen.availWidth,h:screen.availHeight})').catch(() => null);
  if (s) { const o = JSON.parse(s); screenW = o.w; screenH = o.h; }
}

const cols = WINDOWS <= 1 ? 1 : WINDOWS <= 4 ? 2 : WINDOWS <= 6 ? 3 : 4;
const rows = Math.ceil(WINDOWS / cols);
const w = Math.floor(screenW / cols);
const h = Math.floor(screenH / rows);

console.log(`屏幕 ${screenW}x${screenH}，开 ${WINDOWS} 个窗口（${cols}x${rows} 平铺），模式 ${MODE}`);

const workers = [];
const source = PRELUDE + fs.readFileSync(SCRIPT, 'utf8');

for (let i = 0; i < WINDOWS; i++) {
  const created = await bsend('Target.createTarget', { url: 'about:blank', newWindow: true });
  const targetId = created.targetId;
  const win = await bsend('Browser.getWindowForTarget', { targetId });
  await bsend('Browser.setWindowBounds', {
    windowId: win.windowId,
    bounds: {
      left: (i % cols) * w,
      top: Math.floor(i / cols) * h,
      width: w, height: h, windowState: 'normal'
    }
  });

  await sleep(500);
  const tabs = await listTabs(PORT);
  const t = tabs.find(x => x.id === targetId);
  if (!t?.webSocketDebuggerUrl) { console.log(`  W${i + 1}: 创建失败，跳过`); continue; }

  const cdp = await attach(t);
  await cdp.send('Page.navigate', { url: ENTRY });
  await sleep(5000);
  const tid = await cdp.evaluate(SEED);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
  await cdp.send('Page.navigate', { url: ENTRY });

  workers.push({ name: `W${i + 1}`, cdp, tid });
  console.log(`  W${i + 1}: 窗口@(${(i % cols) * w},${Math.floor(i / cols) * h}) ${w}x${h}  标签=${tid}`);
}

if (!workers.length) fail('没有成功创建任何窗口');
ok(`开始并发刷课，运行 ${MINUTES} 分钟（Ctrl+C 可中断）`);

const deadline = Date.now() + MINUTES * 60 * 1000;
const lastSeen = new Map();
while (Date.now() < deadline) {
  await sleep(5000);
  for (const wk of workers) {
    let snap;
    try { snap = await wk.cdp.evaluate(READ); } catch (_) { continue; }
    if (!snap) continue;
    let d;
    try { d = JSON.parse(snap); } catch (_) { continue; }
    const key = `${d.path}|${d.last}|${d.media}`;
    if (lastSeen.get(wk.name) === key) continue;
    lastSeen.set(wk.name, key);
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    console.log(`[${time}] ${wk.name} ${d.path} ${d.media} claims=${d.claims} | ${d.last}`);
  }
}

console.log('时间到，停止自动续跑');
for (const wk of workers) {
  try {
    await wk.cdp.evaluate(`
      (() => {
        const tid = sessionStorage.getItem('ykt_tab_id');
        if (tid) localStorage.removeItem('ykt_pending_auto_start:' + tid);
        return 'stopped';
      })()
    `);
  } catch (_) {}
}
ok('已停止（脚本状态已清理，窗口可自行关闭）');
process.exit(0);
