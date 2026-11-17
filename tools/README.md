# tools/ — 多窗口并发刷课（可选）

这里的脚本**不是安装用户脚本所必需的**。它是进阶用法：比面板里的多窗口开关更稳、
能开更多窗口，因为它以调试模式启动浏览器，顺带关掉了浏览器对后台/遮挡窗口的节流。

前提：**Node.js ≥ 22**（使用内置 `fetch` 与 `WebSocket`，无需 `npm install`）。

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

> 后四个参数是关键：不加的话，被遮挡/后台的窗口里视频会被浏览器节流，`duration` 恒为 0、根本播不动。

---

## 用法

```bash
node tools/brush.mjs --course 33645148 --windows 4 --minutes 30
```

| 参数 | 说明 |
|---|---|
| `--course` | 课堂 id（课程目录页 URL 里的 `classroom_id`） |
| `--windows` | 开几个窗口，实测可到 8 |
| `--minutes` | 运行时长 |
| `--mode` | `all`（默认）/ `fast`（只刷图文·讨论，视频留给串行） |

会按屏幕大小把窗口平铺成网格，并在每个窗口注入用户脚本后自动开始。
各窗口通过脚本内部的认领队列分工，不会重复处理同一条目。

**窗口可以被别的窗口遮住，但不要最小化。**

---

## 和面板里的多窗口开关有什么区别

| | 面板开关 | tools/brush.mjs |
|---|---|---|
| 使用门槛 | 点两下就能用 | 需要命令行 + 以调试模式启动浏览器 |
| 窗口来源 | 当前浏览器新开窗口 | 由脚本创建并平铺 |
| 后台节流 | 未关闭，被遮挡可能变慢 | 已关闭 |
| 适合场景 | 日常 | 想开到 6–8 个窗口、追求满速 |

---

## 免责

这个脚本会以你的身份自动操作学习平台。使用前请确认符合你所在学校的相关规定，
由此产生的一切后果由使用者自行承担。
