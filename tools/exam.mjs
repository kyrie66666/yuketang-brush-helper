#!/usr/bin/env node
// 雨课堂考试工具（基于 CDP，需要浏览器开启远程调试）
//
//   node tools/exam.mjs list   --course 33645148
//   node tools/exam.mjs open   --leaf 94018977
//   node tools/exam.mjs answer --id 4806901 --answers answers.json
//   node tools/exam.mjs verify --id 4806901
//
// 说明：
//   - open 会走雨课堂官方入口（quiz 页 → 开始答题 → 考试系统 → 开始），拿到全部题目并输出 JSON
//   - answer 支持单选/多选/判断（letters）与填空（text），提交前会打印实际勾选状态
//   - 考试系统限制「同一账号同时只能开一个考试页」，不同场次之间请先 close
//
import fs from 'node:fs';
import {
  DEFAULT_PORT, sleep, listTabs, attach, newTab, waitForTab,
  trustedClick, findByTextExpr, fail, ok
} from './cdp.mjs';

const argv = process.argv.slice(2);
const ACTION = argv[0] || '';
const opt = (n, d = '') => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const PORT = Number(opt('port', String(DEFAULT_PORT)));
const COURSE = opt('course', '');
const LEAF = opt('leaf', '');
const ID = opt('id', '');
const ANSWERS_FILE = opt('answers', '');

const EXAMSEL = '.item-body';

function quizUrl(leaf, course) {
  return `https://www.yuketang.cn/ai-workspace/lms-graph/${course}/quiz/${leaf}?is_chapter=1&node_id=0`;
}

// ---------- list：从课程目录读出所有考试 ----------
if (ACTION === 'list') {
  if (!COURSE) fail('需要 --course <classroomId>');
  const url = `https://www.yuketang.cn/v2/web/studentLog/${COURSE}?classroom_id=${COURSE}`;
  const tab = await newTab(url, PORT);
  const cdp = await attach(tab);
  for (let i = 0; i < 30; i++) {
    await sleep(700);
    if (await cdp.evaluate(`!!document.querySelector('.logs-list')`).catch(() => false)) break;
  }
  await sleep(1500);
  const rows = await cdp.evaluate(`(() => {
    const root = document.querySelector('.logs-list');
    if (!root) return JSON.stringify({ err: '未找到课程列表' });
    return JSON.stringify([...root.children].map((el, i) => {
      const sec = el.querySelector('.content-box section');
      const icon = (sec?.querySelector('.tag use')?.getAttribute('xlink:href') || '').replace('#icon-', '');
      const td = sec?.__vue__?.$props?.tableData;
      return {
        i,
        icon,
        title: (sec?.querySelector('h2')?.innerText || '').trim(),
        status: (sec?.querySelector('.statistics-box .aside')?.innerText || '').replace(/\\s+/g, ' ').trim(),
        leafId: td?.content?.leaf_id ?? null,
        leafTypeId: td?.content?.leaf_type_id ?? null,
        proctor: td?.content?.online_proctor ?? null,
        auth: td?.content?.identity_auth ?? null
      };
    }).filter(x => x.icon.includes('kaoshi')));
  })()`);
  const list = JSON.parse(rows || '{}');
  if (list.err) fail(list.err);
  console.log(`共 ${list.length} 场考试：\n`);
  for (const e of list) {
    console.log(`  ${String(e.i).padStart(2)}. ${e.title}`);
    console.log(`      leafId=${e.leafId}  leafTypeId=${e.leafTypeId}  状态=${e.status}  监考=${e.proctor}  认证=${e.auth}`);
  }
  ok('考试列表读取完成');
  process.exit(0);
}

// ---------- open：打开并开始一场考试，导出题目 ----------
if (ACTION === 'open') {
  if (!LEAF) fail('需要 --leaf <leafId>（先用 list 查）');
  if (!COURSE) fail('需要 --course <classroomId>');
  const tab = await newTab(quizUrl(LEAF, COURSE), PORT);
  const cdp = await attach(tab);
  for (let i = 0; i < 30; i++) {
    await sleep(700);
    if (await cdp.evaluate(`!!document.querySelector('iframe.quiz-iframe')?.contentDocument`).catch(() => false)) break;
  }
  await sleep(1500);

  // 关掉须知弹层
  await cdp.evaluate(`(() => {
    const d = document.querySelector('iframe.quiz-iframe')?.contentDocument;
    const b = d && [...d.querySelectorAll('button')].find(x => /我知道了/.test(x.innerText || ''));
    if (b) b.click();
    return true;
  })()`).catch(() => {});
  await sleep(800);

  // 受信任点击 iframe 里的「开始答题 / 继续答题」
  const box = await cdp.evaluate(`(() => {
    const f = document.querySelector('iframe.quiz-iframe');
    const d = f && f.contentDocument;
    if (!d) return { err: '未找到考试 iframe' };
    const b = [...d.querySelectorAll('.btn-quiz')].find(x => /开始答题|继续答题/.test(x.innerText || ''));
    if (!b) return { err: '未找到「开始答题」按钮' };
    b.scrollIntoView({ block: 'center' });
    const fr = f.getBoundingClientRect(), br = b.getBoundingClientRect();
    return { x: fr.x + br.x + br.width / 2, y: fr.y + br.y + br.height / 2 };
  })()`);
  if (!box || box.err) fail(box?.err || '定位失败');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  console.log('已点击开始答题，等待考试系统…');

  const examTab = await waitForTab('examination.xuetangx.com', { port: PORT, timeout: 25000 });
  if (!examTab) fail('没有出现考试系统标签页');
  const ecdp = await attach(examTab);
  await sleep(3000);
  const here = await ecdp.evaluate('location.href').catch(() => '');
  if (here.includes('/warn')) fail('被站点拦截（请勿同时开启多个考试页面），请先关闭其它考试页');

  // 提示框里的「开始」
  const r1 = await trustedClick(ecdp, findByTextExpr('开始'));
  if (!r1.ok) console.log('  （未点到「开始」，可能已在作答页）');
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const u = await ecdp.evaluate('location.href').catch(() => '');
    if (u && u.includes('/exam/')) break;
  }
  await sleep(2000);

  const dump = await ecdp.evaluate(`(() => {
    const items = [...document.querySelectorAll('${EXAMSEL}')];
    return JSON.stringify(items.map((root, i) => {
      const q = (root.querySelector('h4')?.innerText || '').replace(/\\s+/g, ' ').trim();
      const blanks = [...root.querySelectorAll('input[type=text]')].length;
      const kind = blanks ? '填空' : (root.querySelector('.list-unstyled-checkbox') ? '多选' : (root.querySelector('.list-unstyled-radio') ? '单选' : '判断'));
      const opts = [...root.querySelectorAll('label.el-radio, label.el-checkbox')].map(l => ({
        v: l.querySelector('input')?.value ?? '',
        t: (l.innerText || '').replace(/\\s+/g, ' ').trim()
      }));
      return { index: i + 1, kind, question: q, blanks, opts };
    }), null, 1);
  })()`);

  const outFile = `exam-${LEAF}.json`;
  fs.writeFileSync(outFile, dump, 'utf8');
  console.log(dump);
  ok(`题目已导出到 ${outFile}（tabId=${examTab.id}）`);
  process.exit(0);
}

// ---------- answer：按答案作答并交卷 ----------
if (ACTION === 'answer') {
  if (!ID) fail('需要 --id <leafTypeId>');
  if (!ANSWERS_FILE) fail('需要 --answers <file.json>');
  const plan = JSON.parse(fs.readFileSync(ANSWERS_FILE, 'utf8'));
  // 格式：{ "1": ["A","C"], "2": ["B"], "16": "填空答案" }

  const tab = (await listTabs(PORT)).find(t => t.type === 'page' && t.url.includes('/exam/' + ID));
  if (!tab) fail(`找不到 /exam/${ID} 的标签页（先运行 open）`);
  const cdp = await attach(tab);

  let clicked = 0;
  for (const [k, v] of Object.entries(plan)) {
    const qi = Number(k) - 1;

    if (typeof v === 'string') {
      // 填空
      const res = await cdp.evaluate(`(() => {
        const root = [...document.querySelectorAll('${EXAMSEL}')][${qi}];
        const inp = root && root.querySelector('input[type=text]');
        if (!inp) return 'no input';
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(inp, ${JSON.stringify(v)});
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return inp.value;
      })()`);
      console.log(`Q${k} 填空 → ${res}`);
      continue;
    }

    for (const letter of v) {
      const r = await trustedClick(cdp, `(() => {
        const root = [...document.querySelectorAll('${EXAMSEL}')][${qi}];
        if (!root) return { err: '第 ${k} 题不存在' };
        const lb = [...root.querySelectorAll('label.el-radio, label.el-checkbox')]
          .find(l => (l.querySelector('input')?.value || '') === ${JSON.stringify(letter)});
        if (!lb) return { err: '第 ${k} 题没有选项 ${letter}' };
        if (/is-checked/.test(lb.className || '')) return { already: true };
        lb.scrollIntoView({ block: 'center' });
        const rc = lb.getBoundingClientRect();
        return { x: rc.x + rc.width / 2, y: rc.y + rc.height / 2 };
      })()`);
      if (r.ok) clicked++;
      else console.log(`  Q${k} ${letter}: ${r.err}`);
    }
  }
  console.log(`点击 ${clicked} 次`);

  const state = await cdp.evaluate(`(() => {
    const items = [...document.querySelectorAll('${EXAMSEL}')];
    return JSON.stringify(items.map((r, i) => ({
      q: i + 1,
      picked: [...r.querySelectorAll('.el-radio.is-checked,.el-checkbox.is-checked')].map(l => l.querySelector('input')?.value),
      blanks: [...r.querySelectorAll('input[type=text]')].map(x => x.value).filter(Boolean)
    })).filter(x => x.picked.length || x.blanks.length));
  })()`);
  console.log('作答状态:', state);

  // 交卷
  const s1 = await trustedClick(cdp, `(() => {
    const b = [...document.querySelectorAll('.el-button.tosubmit')].find(x => /交卷/.test(x.innerText || ''));
    if (!b) return { err: '未找到交卷按钮' };
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!s1.ok) fail(s1.err);
  await sleep(2500);
  const s2 = await trustedClick(cdp, `(() => {
    const bs = [...document.querySelectorAll('.el-message-box__btns button')]
      .filter(b => (b.innerText || '').trim() === '交卷' && b.getBoundingClientRect().width > 0);
    if (!bs.length) return { err: '未出现确认弹窗' };
    const r = bs[bs.length - 1].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!s2.ok) fail(s2.err + '（可能已自动提交）');
  await sleep(6000);
  ok('已交卷，可运行 verify 查看得分');
  process.exit(0);
}

// ---------- verify：读结果页 ----------
if (ACTION === 'verify') {
  if (!ID) fail('需要 --id <leafTypeId>');
  const tab = (await listTabs(PORT)).find(t => t.type === 'page' && (t.url.includes('/cover/' + ID) || t.url.includes('/result/' + ID)));
  if (!tab) fail(`找不到结果页（先运行 answer）`);
  const cdp = await attach(tab);
  if (!tab.url.includes('/result/')) {
    await cdp.evaluate(`location.href='https://examination.xuetangx.com/result/${ID}?isFrom=2'`);
    await sleep(7000);
  }
  const summary = await cdp.evaluate(`(() => {
    const t = (document.body.innerText || '').replace(/\\s+/g, ' ');
    const raw = t.match(/本题得分：\\s*(\\d+)\\s*分/g) || [];
    const scores = raw.map(s => parseInt(s.replace(/\\D/g, ''), 10) || 0);
    const answers = t.match(/正确答案：\\s*[A-F,，]+/g) || [];
    return JSON.stringify({
      questions: scores.length,
      total: scores.reduce((a, b) => a + b, 0),
      wrong: scores.filter(s => s === 0).length,
      correctAnswers: answers
    });
  })()`);
  console.log(summary);
  process.exit(0);
}

console.error(`用法:
  node tools/exam.mjs list   --course <classroomId>
  node tools/exam.mjs open   --course <classroomId> --leaf <leafId>
  node tools/exam.mjs answer --id <leafTypeId> --answers answers.json
  node tools/exam.mjs verify --id <leafTypeId>`);
process.exit(1);
