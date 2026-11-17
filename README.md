# 雨课堂刷课助手

一个面向[雨课堂](https://www.yuketang.cn)的用户脚本（Userscript）：自动播放课程视频/音频、
翻阅图文与课件、自动回复讨论，可选接入大模型自动做作业。

- **版本**：v3.1.0（适配 2026.11 改版）
- **许可证**：[GPL-3.0](LICENSE)
- **适用**：Tampermonkey / Violentmonkey 等脚本管理器（Chrome、Edge、Firefox）

> **v3.1.0 说明**
> 雨课堂已把课程内容整体迁移到 `/ai-workspace/lms-graph/...` 路由，旧版选择器基本失效。
> 本版完成重新适配，并实测跑完一门包含 293 个学习单元的课程
> （116 图文 + 43 视频 + 134 讨论，最终 293/293 全部完成）。
> 改动明细见 [releaseLog.md](releaseLog.md)。

![界面截图](images/image.png)

---

## 功能

| 功能 | 说明 |
|---|---|
| 自动刷视频 | 2 倍速 + 静音，播完自动切下一节，支持断点续刷 |
| 自动刷音频 | 批量区里的音频单元自动播放 |
| 图文 / 课件 | 自动打开、翻页（PPT 逐张点）、识别"已读"状态 |
| 讨论自动回复 | 可配置为复制已有发言回复（需手动开启） |
| 作业自动作答 | 截图 OCR + 大模型作答（需自备 API Key，手动开启） |
| 防挂机 | 防切屏检测、自动关闭挂机提示、自动续播 |
| 多窗口并发 | 多个窗口各刷不同条目，互不重复（可选，大幅提速） |

---

## 安装

1. 先给浏览器安装脚本管理器：[Tampermonkey](https://www.tampermonkey.net/)
   （Firefox 也可用 Violentmonkey / Greasemonkey）
2. 点击下面的链接，脚本管理器会自动弹出安装页：

   **https://raw.githubusercontent.com/kyrie66666/yuketang-jiaoben/main/yuketang.user.js**

3. 在弹出的页面点「安装」即可。

> 脚本已内置 `@updateURL`，之后本仓库更新版本时，Tampermonkey 会自动提示升级。

如果点击链接没有反应（某些浏览器会把它当普通文件打开），可以：
打开上述链接 → 全选复制 → Tampermonkey 面板「添加新脚本」→ 粘贴覆盖 → 保存。

---

## 使用

### 1. 开始刷课

1. 打开雨课堂网页版，进入**课程的「学习日志 / 目录」页面**
   （不是视频播放页，是能看到整章列表的那一页）
2. 右下角会出现"雨课堂刷课助手"面板
3. 点「**开始刷课**」

脚本会自动逐条往下刷。中途刷新页面或跳转后，会**自动续刷**，不需要重新点。

面板上的按钮：

| 按钮 | 作用 |
|---|---|
| AI配置 | 填写大模型 API（URL / Key / 模型名 / 格式） |
| 清除缓存 | 清掉当前课程的刷课进度 |
| 开始刷课 | 启动 |
| 停止刷课 | 清除续刷标记并刷新页面，回到空闲状态 |
| 重新加载 | 刷新页面并自动续刷（卡住时用） |

### 2. 启用 AI 自动作答（可选）

「AI配置」里填入以下任一项服务即可，脚本兼容 OpenAI 与 Anthropic 两种接口格式：

| 服务 | API URL | 模型名示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/chat/completions` | `deepseek-chat` |
| Kimi | `https://api.moonshot.cn/v1/chat/completions` | `moonshot-v1-8k` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | `qwen-plus` |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |
| Claude | `https://api.anthropic.com/v1/messages` | `claude-3-5-sonnet-20241022` |

填完后在配置页勾选「用 AI 自动作答」和/或「用批量区图文/讨论自动回复」。
未勾选时脚本不会调用任何 AI 接口。

### 3. 多窗口并发（可选，大幅提速）

视频是刷课最耗时的部分。脚本支持**多个窗口同时刷**，通过 localStorage 认领队列保证互不重复。

1. **必须开独立窗口，不要在同一个窗口开多个标签页。**
   浏览器会节流后台标签页，导致视频 `duration` 恒为 0、根本播不动。
2. 建议用带反节流参数的浏览器启动（见 [tools/README.md](tools/README.md)）。
3. 窗口可以被其它窗口挡住，但**不要最小化**。

两个开关（浏览器控制台执行）：

```js
localStorage.setItem('ykt_mode', 'fast')      // 只刷图文/讨论，视频留给串行
localStorage.setItem('ykt_exam_mode', 'on')   // 遇到考试时自动帮你打开考试系统
```

| 键 | 取值 | 作用 |
|---|---|---|
| `ykt_mode` | `all`（默认）/ `fast` | `fast` 只处理秒级条目，并发更高效 |
| `ykt_exam_mode` | `off`（默认）/ `on` | `on` 时自动打开考试系统（仍需人工作答） |

---

## 关于考试

**脚本不自动作答考试。** 原因：

- 考试系统在另一个域名 `examination.xuetangx.com`，用户脚本的 `@match` 不覆盖
- 选项是 Vue 受控组件，**必须用受信任事件**才能勾选，油猴脚本无法伪造

脚本对考试只做两件事：

- 识别考试项，**默认停在「考生须知」页不动**（不消耗任何作答机会）
- 设 `ykt_exam_mode=on` 时，帮你打开考试系统，然后提示你人工作答

> 打开考试页**不会**消耗作答机会，只有点「开始答题」→「开始」才真正开始。
> 刷课流程经过考试项会自动跳过。

想了解完整的实测结论与 DOM 结构，见 [docs/exam.md](docs/exam.md)。

---

## 高级：tools/ 外部自动化

仓库里的 [tools/](tools/README.md) 提供两件事（需要 Node.js ≥ 22，无需 `npm install`）：

```bash
# 多窗口并发刷课
node tools/brush.mjs --course <课堂id> --windows 4 --minutes 30

# 考试工具：列考试 / 开始并导出题目 / 作答交卷 / 查分
node tools/exam.mjs list   --course <课堂id>
node tools/exam.mjs open   --course <课堂id> --leaf <leafId>
node tools/exam.mjs answer --id <leafTypeId> --answers answers.json
node tools/exam.mjs verify --id <leafTypeId>
```

前置条件与详细用法见 [tools/README.md](tools/README.md)。

---

## 常见问题

**Q：面板不出现 / 不显示悬浮窗？**
A：确认脚本已启用、页面是 `*.yuketang.cn` 或 `*.gdufemooc.cn`、并且刷新一次页面。
部分学校域名不同，需要在 Tampermonkey 里给脚本加 `@match`。

**Q：视频刷完进度还是 98%/99%？**
A：v3.1.0 已修复（改为必须等到播放器真正 `ended` 才离开）。如果仍出现，点「重新加载」。

**Q：刷到一半停了？**
A：点「重新加载」即可从当前进度继续。长时间挂机时别最小化浏览器窗口。

**Q：某个条目不处理、一直跳过？**
A：脚本对失败的条目有 10 分钟冷却，期间会跳过它去处理别的，冷却后自动重试。

**Q：会不会重复刷同一条？**
A：不会。进度按「站点 + 路径 + 课堂 id」记录，多窗口之间用认领队列互斥。

---

## 目录结构

```
yuketang.user.js   用户脚本本体（唯一需要安装的文件）
docs/exam.md       考试系统的实测结论与 DOM 结构
tools/             外部自动化工具（可选）
test/              fixture 回归测试
releaseLog.md      版本更新记录
images/            截图
```

## 开发与测试

脚本为单文件、无构建步骤。改动后可直接用 `node --check yuketang.user.js` 校验语法。

回归测试（需要本机有可远程调试的浏览器）：

```bash
node test/run-fixtures.mjs --port 9222
```

测试用本地 fixture 复刻现网的 forum / video / graph 三种页面结构，通过 CDP 注入脚本并断言行为。
详见 [test/README.md](test/README.md)。

---

## 许可证

[GNU General Public License v3.0](LICENSE)。

- 原始脚本作者：风之子（[Niuwh/yuketang-jiaoben](https://github.com/Niuwh/yuketang-jiaoben)）
- 本仓库在其基础上完成了 2026.11 改版适配、多窗口并发、回归测试与 `tools/` 工具

你可以自由使用、修改、分发本项目；分发修改后的版本时，**必须同样以 GPLv3 开源并提供源码**，
并保留原有版权声明。

---

## 免责声明

本项目为开源用户脚本，仅供学习、交流与技术研究使用。脚本通过浏览器端 DOM 操作增强页面功能，
不修改服务器数据、不绕过账号权限、不包含任何破坏性操作。

使用本项目即表示你已了解其工作原理，并自行承担使用后果。请遵守所在平台的服务条款与学校的
学术诚信规定。作者不对因使用本脚本导致的任何成绩、账号或其它损失负责。

若本项目无意侵犯了您的权益，请联系作者删除。
