// 共享的 CDP 基础库（无第三方依赖，Node >= 22）
//
// 为什么需要它：雨课堂的考试系统在 examination.xuetangx.com，选项是 Vue 受控组件，
// 合成事件 element.click() 不生效，必须用 CDP 派发「受信任」鼠标事件。
// 油猴脚本拿不到 isTrusted 事件，所以这类操作只能走外部调试通道。

export const DEFAULT_PORT = 9222;

export class Cdp {
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

  send(method, params = {}, timeoutMs = 20000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP 超时: ${method}`));
      }, timeoutMs);
    });
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result?.value;
  }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function listTabs(port = DEFAULT_PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`CDP 返回 HTTP ${res.status}`);
  return res.json();
}

export async function browserInfo(port = DEFAULT_PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  return res.json();
}

const openWs = url => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => resolve(ws), { once: true });
  ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败: ' + url)), { once: true });
});

/** 连接到指定 target，返回 Cdp 实例 */
export async function attach(target, { enablePage = true } = {}) {
  const ws = await openWs(target.webSocketDebuggerUrl);
  const cdp = new Cdp(ws);
  if (enablePage) await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

/** 新建标签页并返回其 target 信息 */
export async function newTab(url, port = DEFAULT_PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURI(url)}`, { method: 'PUT' });
  const t = await res.json();
  // 部分版本返回时还没有 webSocketDebuggerUrl，回查一次
  if (!t.webSocketDebuggerUrl) {
    await sleep(500);
    const all = await listTabs(port);
    return all.find(x => x.id === t.id) || t;
  }
  return t;
}

/** 按 URL 子串等待标签页出现 */
export async function waitForTab(pattern, { port = DEFAULT_PORT, timeout = 25000, interval = 700 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const all = await listTabs(port);
    const hit = all.find(x => x.type === 'page' && x.url.includes(pattern));
    if (hit) return hit;
    await sleep(interval);
  }
  return null;
}

/**
 * 派发「受信任」鼠标点击。
 * findExpr 需要在页面里返回 {x, y}（视口坐标），或 {already:true} 表示无需点击。
 */
export async function trustedClick(cdp, findExpr) {
  const box = await cdp.evaluate(findExpr);
  if (!box) return { ok: false, err: '定位失败' };
  if (box.err) return { ok: false, err: box.err };
  if (box.already) return { ok: true, already: true };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(350);
  return { ok: true };
}

/** 在页面里按文字找可点击元素并返回坐标表达式（元素会被滚入可视区） */
export function findByTextExpr(text) {
  return `(() => {
    const cands = [...document.querySelectorAll('button, .el-button, [role="button"], div[class*="btn"], a')]
      .filter(el => (el.innerText || '').trim() === ${JSON.stringify(text)});
    if (!cands.length) return { err: '找不到「${text}」' };
    cands.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    const el = cands[cands.length - 1];
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return { err: '「${text}」不可见' };
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`;
}

export function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

export function ok(msg) {
  console.log('✓ ' + msg);
}
