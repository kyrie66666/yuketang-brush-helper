# 贡献指南

感谢你愿意改进这个项目。以下是参与前需要了解的约定。

## 提交 Issue

- **Bug 反馈**请使用 [Bug 模板](.github/ISSUE_TEMPLATE/bug_report.yml)，并尽量附上：
  - 浏览器与脚本管理器版本
  - 出问题的页面 URL（**请隐去课堂 id、姓名等个人信息**）
  - 脚本面板的日志（面板里最后几行通常就够）
  - 浏览器控制台报错（F12 → Console）
- **新需求**请使用 [功能模板](.github/ISSUE_TEMPLATE/feature_request.yml)，说明你希望解决什么问题。
- 提问前建议先看 [README 的常见问题](README.md#常见问题)。

## 提交代码

1. Fork 本仓库并从 `main` 拉一个分支，分支名建议 `fix/xxx` 或 `feat/xxx`
2. 改动后必须通过以下检查：

   ```bash
   node --check yuketang.user.js          # 语法
   node test/run-fixtures.mjs --port 9222 # 回归测试（需要可远程调试的浏览器）
   ```

3. 提交信息请说明「改了什么、为什么改」，涉及 bug 时附上复现步骤
4. 发起 Pull Request，并在描述里写清测试方式

## 代码约定

- 脚本为**单文件、零构建**，不引入 npm 依赖或打包步骤
- 所有 DOM 选择器请**多写几个候选**，并优先用稳定的类名；雨课堂改版频繁，
  单一选择器很容易整段失效（历史教训见 CHANGELOG 中 3.1.0 的讨论区修复）
- 网络请求统一走 `GM_xmlhttpRequest`，便于跨域
- 新增异步流程时注意加超时与「放弃」分支，避免把窗口/标签页长时间占死
- 面向用户的日志请写中文，并带上足够上下文（哪一集、什么类型、当前状态）

## 新增功能时

- 如果涉及新的页面类型或新的 DOM 结构，请在 `test/fixtures/` 里补一个 fixture，
  并在 `test/run-fixtures.mjs` 里加对应断言
- 涉及 `localStorage` 新键时，请在 README 的配置表格中登记

## 许可证

本项目采用 [GPL-3.0](../LICENSE)。提交代码即表示你同意以相同许可证发布你的贡献。
