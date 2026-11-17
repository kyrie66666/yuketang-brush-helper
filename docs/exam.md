# 考试功能说明（人工辅助）

## 结论

**本脚本不自动作答考试。** 这是有意为之，不是没做完。

## 为什么不能自动作答

2026.11 实测「专题十 中国道路与世界格局演变前景单元测验题」得到的结论：

| 观察 | 结果 |
|---|---|
| 考试项路由 | `/ai-workspace/lms-graph/<cid>/quiz/<leafId>`（type = `quiz`） |
| 须知页位置 | 外层页面的 `iframe.quiz-iframe`，指向 `/v2/web/iframe-quiz/<cid>/<leafTypeId>` |
| 打开须知页时 | 题目加载数 **0**，只有「考生须知」和「开始答题」按钮 |
| 点「开始答题」后 | **在新标签页打开 `https://examination.xuetangx.com/start/<leafTypeId>`**，不是 iframe 内换页 |
| 该页内容 | 「提示 / 考试不限时」对话框 + 「暂不开始 / 开始」按钮 |
| 页面内 iframe | 只有腾讯验证码 `turing.captcha.gtimg.com`（跨域） |

因此想要自动作答，需要同时跨越：

1. **跨域**：脚本 `@match` 只覆盖 `*.yuketang.cn`，考试系统在 `examination.xuetangx.com`
2. **验证码**：考试流程里存在腾讯点选/拖拽验证码
3. **盲区**：只有点了「开始」之后才能看到题目 DOM，而点「开始」就会消耗一次作答机会

也就是说，**必须先付出一次考试机会，才能知道题目 DOM 长什么样**。对于一次性、有次数的
考试来说，这个代价不可接受，所以本项目选择不做。

## 脚本实际做了什么

| 场景 | 行为 |
|---|---|
| 默认（`ykt_exam_mode` 未设置） | 打开考试项后停在「考生须知」页，面板提示未开始；**不点击任何按钮** |
| `ykt_exam_mode = 'on'` | 帮你点「开始答题」→ 弹出考试系统新标签页 → 面板提示「请人工作答并交卷」 |
| 刷课流程经过考试项 | 直接跳过，日志记录「考试区域脚本会被屏蔽，已跳过」 |

## 安全提示

- **打开考试页不消耗作答机会**：须知页只是信息页，题目都没有加载。
- **点「开始答题」会打开考试系统**，在那边点「开始」才真正开始计时。
- 本站考试**不限时**，截止时间由课程设定（本例为 2027-01-10）；退出后计时仍继续，
  时长用尽或到截止时间会自动交卷。
- 因为不限时，即使误点「开始」，也可以在截止前从容继续作答。

## 补充：关于"能不能自动作答题"（2026.11 实测结论）

在实际完成 12 场考试后，结论要修正得更精确：

- **题目是可以自动作答的**，但**不能由 userscript 完成**。
- 原因：考试选项是 Element UI 的 `label.el-radio` / `label.el-checkbox`，
  用合成事件 `element.click()` **无法稳定改变选中状态**（实测：10 个选项里只有最后点的那个生效，
  因为 Vue 的受控状态只认受信任事件）。
  只有 **CDP `Input.dispatchMouseEvent` 派发的受信任事件**才能正确勾选。
  而浏览器里的 userscript 无法产生 `isTrusted: true` 的事件。
- 因此本项目不做考试自动作答；如果将来要做，必须借助外部自动化（CDP/Puppeteer/Playwright），
  而不是油猴脚本。

### 实测得到的关键结构（供将来参考）

| 环节 | 选择器 / 事实 |
|---|---|
| 考试列表项 | `#icon-kaoshi`，Vue `$props.tableData.content.leaf_id` / `leaf_type_id` |
| 雨课堂侧入口 | `/ai-workspace/lms-graph/<cid>/quiz/<leafId>`，内容在 `iframe.quiz-iframe` |
| 须知页 | 有「开始答题」；已开始时显示「继续答题」 |
| 考试系统 | `https://examination.xuetangx.com/start/<leafTypeId>` → 点「开始」→ `/exam/<leafTypeId>` |
| 题目容器 | `.item-body`（每题一个），题干在 `h4` |
| 选项 | `ul.list-unstyled-radio` / `ul.list-unstyled-checkbox`，`label` 内 `input.value` = A/B/C/D… |
| 填空题 | `input[type=text]`（**精确匹配判分，猜错为 0**） |
| 交卷 | `.el-button.tosubmit` → 确认弹窗 `.el-message-box__btns` 里的「交卷」 |
| 结果页 | `/result/<id>`，可读到「本题得分」「正确答案」 |
| 限制 | 同一账号**同时只能开一个考试页**，否则跳 `/warn` |

### 实测成绩（同一账号 12 场）

客观题（单选/多选/判断）几乎全对；**填空题 10 题全错**，因为答案需要精确文字，
靠推断无法命中。这印证了：客观题可自动化，填空/主观题不可靠。



需要先解决上面的三点。可行的推进顺序：

1. 给外部自动化加 `examination.xuetangx.com` 的访问（CDP/Playwright，而非油猴）
2. 用**你愿意牺牲的一场考试**换取一次进入作答界面的机会，把题目 DOM 结构记录下来
3. 基于真实 DOM 实现「读题 → OCR/AI → 选项 → 填入 → 交卷」，并像 `test/` 里那样写 fixture 回归测试
4. 验证通过后再默认关闭、按需开启

在没走完这套之前，建议保持人工作答。
