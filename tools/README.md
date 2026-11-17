# tools/ — 高级自动化（可选）

这里的脚本**不是安装用户脚本所必需的**。它们是给想更进一步的人用的：

- 多窗口并发刷课（把串行 3 小时压到 1 小时内）
- 考试自动作答（用户脚本做不到，见下文）

前提都是：**Node.js ≥ 22**（使用内置 `fetch` 与 `WebSocket`，无需 `npm install`），
以及一个开启了远程调试端口的 Edge/Chromium。

---

## 为什么要单独做一套

雨课堂在 2026.11 改版后，课程内容迁移到 `/ai-workspace/lms-graph/...`；
考试更是跑在**另一个域名** `examination.xuetangx.com` 上。

其中考试遇到过两个硬限制，导致油猴脚本无法胜任：

1. **跨域**：用户脚本的 `@match` 只覆盖 `*.yuketang.cn`，考试系统不在其中
2. **受信任事件**：考试选项是 Vue 受控组件，用 `element.click()` 这类**合成事件**
   无法稳定改变选中状态（实测 10 个选项只有最后点的那个生效）。
   只有 CDP `Input.dispatchMouseEvent` 派发的 `isTrusted: true` 事件才会被接受，
   而浏览器里的用户脚本无法伪造受信任事件。

所以考试自动化只能走**外部调试通道**（CDP），也就是这里的脚本。

---

## 启动浏览器

Chromium 自 2025 年起禁止对**默认**用户数据目录开远程调试，必须指定一个独立目录：

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:LOCALAPPDATA\EdgeCdpProfile" `
  --disable-background-timer-throttling `
  --disable-backgrounding-occluded-windows `
  --disable-renderer-backgrounding `
  --disable-features=CalculateNativeWinOcclusion `
  --autoplay-policy=no-user-gesture-required `
  --no-first-run "https://www.yuketang.cn"
```

在这个窗口里登录一次，登录态会保存在该目录，之后不用重复登录。

> 后四个参数是并发刷课必需的：不加的话，后台窗口/标签的视频会因为浏览器节流而
> `duration` 恒为 0、根本播不动。

---

## 用法

### 1. 多窗口并发刷课

```bash
node tools/brush.mjs --course 33645148 --windows 4 --minutes 30
```

| 参数 | 说明 |
|---|---|
| `--course` | 课堂 id（课程目录页 URL 里的 `classroom_id`） |
| `--windows` | 开几个窗口，实测可到 8 |
| `--minutes` | 运行时长 |
| `--mode` | `all`（默认）/ `fast`（只刷图文·讨论，视频留给串行） |

会按屏幕大小把窗口平铺成网格。**窗口可以被别的窗口遮住，但不要最小化**。

### 2. 考试

```bash
# 列出这门课的所有考试（标题 / leafId / leafTypeId / 状态）
node tools/exam.mjs list --course 33645148

# 打开并开始一场考试，导出题目到 exam-<leafId>.json
node tools/exam.mjs open --course 33645148 --leaf 94018977

# 按答案文件作答并交卷
node tools/exam.mjs answer --id 4806901 --answers my-answers.json

# 查看得分与正确答案
node tools/exam.mjs verify --id 4806901
```

答案文件格式：

```json
{
  "1": ["A"],
  "2": ["A", "C", "D"],
  "16": "新发展",
  "26": ["true"]
}
```

- 选择题写字母数组（`A`–`F`）
- 判断题的选项值是 `true` / `false`
- 填空题直接写字符串

**注意**：

- 考试系统限制「同一账号同时只能开一个考试页」，不同场次之间先关掉上一个标签页，
  否则会跳到 `/warn`。
- 打开考试页本身**不消耗作答机会**，只有点「开始」才开始；但 `open` 会替你点「开始」。
- 填空题是**精确匹配判分**，靠猜基本不得分——请先自行查证答案再填。

---

## 实测成绩（同一账号 12 场）

| 类别 | 成绩 |
|---|---|
| 10 场单元测验（各 3 题） | 28/30 |
| 期末测验（20 题） | 20/20 |
| 平时作业（30 题，含 10 道填空） | 20/30 |

失分全部来自两处：多选题多选了"比喻性"选项、填空题精确匹配失败。
客观题（单选/多选/判断）基本可以做到全对。

---

## 免责

这些脚本会以你的身份自动操作学习平台。使用前请确认符合你所在学校的相关规定，
由此产生的一切后果由使用者自行承担。
