# fixture 回归测试

针对 2026.11 雨课堂改版（课程内容整体迁移到 `/ai-workspace/lms-graph/<课堂id>/<type>/<leaf>`）的回归测试。

不依赖真实账号、不访问现网，用本地 fixture 复刻现网 DOM，再用 CDP 驱动一个真实浏览器注入 `yuketang.user.js` 做断言。

## 前置

一个开着远程调试端口的 Edge/Chromium：

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:TEMP\edge-fixture" `
  --no-first-run about:blank
```

> 注意：Chromium 自 2025 年起禁止对**默认**用户数据目录开启远程调试，必须带一个独立的 `--user-data-dir`，否则 9222 端口不会监听。

## 运行

```powershell
node test/run-fixtures.mjs --port 9222 --http-port 8787
```

可选参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--port` | 9222 | CDP HTTP 端口 |
| `--http-port` | 8787 | fixture 静态服务器端口 |
| `--script` | `../yuketang.user.js` | 被测脚本路径，可指向旧版本做对照 |

退出码：全部通过为 `0`，有失败为 `1`。

## 覆盖的场景

| 场景 | fixture | 断言 |
|---|---|---|
| 讨论区自动回复 | `fixtures/forum.html` | 读到 `.comment-text` 的已有发言 → 写入 `.prompt-send-box textarea` → 点击 `.prompt-send-btn` 成功提交（结果留在 `localStorage.__FIXTURE_POSTED__`） |
| 视频/音频必须刷满 | `fixtures/video.html` | 必须等到媒体真正触发 `ended`（`__FIXTURE_ENDED__`）**且**回到目录页，防止在结尾前 1 秒就判完成跳走导致进度停在 98%/99% |
| 图文（graph） | `fixtures/graph.html` | 识别为 `graph` 类型、跳过内容处理并返回目录页 |

## 已验证的鉴别力

用同一套测试跑上游原始版本 `d4170d7`：

```
✘ FAIL  forum  → 面板日志：当前类型为 forum，当前暂不自动处理此类型，自动跳过
✘ FAIL  video  → 播放完成后一直停在内容页（returnToSource 无 opener 时无任何兜底）
✘ FAIL  graph  → 同上
0 passed, 3 failed
```

修复版 `3.0.7` 全部通过。说明这些用例确实能卡住回归，而不是走过场。

## 注意

- 每个场景开始会清掉 `__FIXTURE_*` 与 `ykt_pending_auto_start`；同一 origin 的 localStorage 会在多次运行间残留，不清会误判通过。
- fixture 只在本地 `127.0.0.1` 上运行，不接触任何线上数据。
