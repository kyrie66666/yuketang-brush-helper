#!/usr/bin/env node
/**
 * fixture 回归测试
 *
 * 目的：在没有真实账号、不依赖现网的情况下，稳定复现并验证本次适配的三条链路：
 *   1. forum（讨论区）自动回复 —— 读 .comment-text、写 textarea、点 .prompt-send-btn
 *   2. video/audio 进度必须刷满 —— 必须等到媒体真正触发 ended 才离开内容页
 *   3. graph（图文）—— 识别为 graph 类型、跳过内容处理并返回目录页
 *
 * 做法：本地 HTTP 服务器把 fixtures 挂在真实的 /ai-workspace/lms-graph/<cid>/<type>/<leaf>
 * 路径上，用 CDP 驱动一个真实 Chromium/Edge 页面，注入 yuketang.js（带 GM_* stub），
 * 然后断言页面侧的可观察结果。
 *
 * 用法：
 *   node test/run-fixtures.mjs [--port 9222] [--http-port 8787] [--script ../yuketang.js]
 *
 * 前置：一个带 --remote-debugging-port 的 Edge/Chromium 正在运行。
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const opt = (name, def = '') => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

const CDP_PORT = Number(opt('port', '9222'));
const HTTP_PORT = Number(opt('http-port', '8787'));
const SCRIPT_PATH = path.resolve(HERE, opt('script', '../yuketang.js'));
const CLASSROOM = '33645148';
const BASE = `http://127.0.0.1:${HTTP_PORT}`;

// ---------------- 静态服务器 ----------------
const ROUTES = [
  [/^\/ai-workspace\/lms-graph\/\d+\/forum\/[^/]+/, 'forum.html'],
  [/^\/ai-workspace\/lms-graph\/\d+\/video\/[^/]+/, 'video.html'],
  [/^\/ai-workspace\/lms-graph\/\d+\/audio\/[^/]+/, 'video.html'],
  [/^\/ai-workspace\/lms-graph\/\d+\/graph\/[^/]+/, 'graph.html'],
  [/^\/return-marker/, 'marker.html'],
];

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, BASE).pathname;
  const hit = ROUTES.find(([re]) => re.test(pathname));
  if (!hit) { res.writeHead(404); res.end('not found'); return; }
  const file = path.join(HERE, 'fixtures', hit[1]);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(file));
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(HTTP_PORT, '127.0.0.1', resolve);
});

// ---------------- 最小 CDP 客户端 ----------------
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id === undefined) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error('CDP 超时: ' + method)); }, 60000);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
}

const openWs = url => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => resolve(ws), { once: true });
  ws.addEventListener('error', () => reject(new Error('WS 连接失败')), { once: true });
});

// 新建一个独立标签页（不继承 opener，才能真实覆盖「同标签页跳转」分支）
let target;
try {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
  target = await res.json();
} catch (e) {
  console.error(`连不上 CDP ${CDP_PORT}：${e.message}`);
  console.error('请先用 --remote-debugging-port 启动 Edge/Chromium。');
  process.exit(2);
}

const ws = await openWs(target.webSocketDebuggerUrl);
const cdp = new Cdp(ws);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

// ---------------- 注入代码 ----------------
const userScript = fs.readFileSync(SCRIPT_PATH, 'utf8');
const PRELUDE = `
window.unsafeWindow = window;
window.GM_xmlhttpRequest = function (o) { try { o.onerror && o.onerror(); } catch (e) {} };
window.__FIXTURE__ = true;
`;
const INJECT = PRELUDE + '\n' + userScript;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const waitReady = async (timeout = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const state = await cdp.evaluate('document.readyState');
      if (state === 'complete') return true;
    } catch (_) { /* 导航中 */ }
    await sleep(200);
  }
  return false;
};

async function goto(url) {
  await cdp.send('Page.navigate', { url });
  await waitReady();
}

async function poll(expression, timeoutMs, label) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await cdp.evaluate(expression);
      if (value) return { ok: true, value, ms: Date.now() - start };
    } catch (e) { lastErr = e; }
    await sleep(300);
  }
  return { ok: false, value: null, ms: Date.now() - start, error: lastErr?.message };
}

const seed = (returnUrl) => `
  // 每个场景开始前清掉留痕，否则同一 origin 上轮的结果会让断言误判通过
  try {
    localStorage.removeItem('__FIXTURE_POSTED__');
    localStorage.removeItem('__FIXTURE_ENDED__');
    localStorage.removeItem('ykt_pending_auto_start');
  } catch (e) {}
  localStorage.setItem('ykt_feature_conf', JSON.stringify({ autoAI: false, autoComment: true }));
  localStorage.setItem('ykt_pending_auto_start', JSON.stringify({
    classroomId: '${CLASSROOM}',
    returnUrl: ${JSON.stringify(returnUrl)},
    ts: Date.now()
  }));
  'seeded'
`;

// ---------------- 场景 ----------------
const results = [];

async function scenario(name, { url, seedReturnUrl, inject = true, expect, timeout = 40000 }) {
  process.stdout.write(`\n▶ ${name}\n`);
  try {
    await goto(BASE + url);
    await cdp.evaluate(seed(seedReturnUrl || BASE + '/return-marker'));
    if (inject) await cdp.evaluate(INJECT);

    const r = await poll(expect.expression, timeout, expect.label);
    if (r.ok) {
      results.push({ name, ok: true, detail: JSON.stringify(r.value).slice(0, 160), ms: r.ms });
      console.log(`  PASS (${r.ms}ms) → ${JSON.stringify(r.value).slice(0, 160)}`);
    } else {
      const logs = await cdp.evaluate(`(() => {
        const f = document.getElementById('ykt-helper-iframe');
        const i = f && f.contentDocument && f.contentDocument.getElementById('info');
        return i ? i.innerText.split('\\n').slice(-6).join(' | ') : '(无面板)';
      })()`).catch(() => '(读取失败)');
      results.push({ name, ok: false, detail: r.error || 'timeout', logs });
      console.log(`  FAIL (${r.ms}ms) ${r.error || '超时'}\n  面板日志: ${logs}`);
    }
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
    console.log(`  ERROR: ${e.message}`);
  }
}

// 1) 讨论区自动回复
await scenario('forum：读取已有发言并成功提交', {
  url: `/ai-workspace/lms-graph/${CLASSROOM}/forum/94018777`,
  timeout: 40000,
  expect: {
    label: '等待发帖留痕 __FIXTURE_POSTED__',
    expression: `localStorage.getItem('__FIXTURE_POSTED__') || null`
  }
});

// 2) 视频/音频必须播到真正 ended 才返回
//    只断言"跳回了目录页"不够：旧实现在结尾前 1 秒就判完成并跳走，同样会跳回。
//    这里要求 __FIXTURE_ENDED__ 与"已跳回"同时成立，才能证明是等到 ended 之后才离开。
await scenario('video：等到 ended 后才离开内容页', {
  url: `/ai-workspace/lms-graph/${CLASSROOM}/video/94018847`,
  timeout: 60000,
  expect: {
    label: '等待 ended 留痕 + 跳转到 /return-marker',
    expression: `(localStorage.getItem('__FIXTURE_ENDED__') && location.pathname === '/return-marker')
      ? { ended: true, path: location.pathname } : null`
  }
});

// 3) 图文页：识别为 graph、跳过并返回
await scenario('graph：识别 graph 类型后返回目录页', {
  url: `/ai-workspace/lms-graph/${CLASSROOM}/graph/94018785`,
  timeout: 45000,
  expect: {
    label: '等待跳转到 /return-marker',
    expression: `location.pathname === '/return-marker' ? { path: location.pathname } : null`
  }
});

// ---------------- 汇总 ----------------
console.log('\n================ 汇总 ================');
for (const r of results) {
  console.log(`${r.ok ? '✔ PASS' : '✘ FAIL'}  ${r.name}${r.ok ? '' : '  → ' + r.detail}`);
}
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);

try { ws.close(); } catch (_) {}
try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`); } catch (_) {}
server.close();
process.exit(failed === 0 ? 0 : 1);
