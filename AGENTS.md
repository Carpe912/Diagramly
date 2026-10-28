# 项目协作规范

- 用户已授权：每项功能或修复完成并验证后，自动创建对应的 Git 提交；不同功能分别提交。
- 提交信息遵循 Conventional Commits，格式为 `type(scope): 中文说明`：类型和作用域使用英文，冒号使用半角，说明使用中文。例如 `feat(core): 新增泳池布局命令`、`fix(ui): 修复泳道工具栏定位`、`docs(workflow): 更新协作规范`。
- 按改动性质选择 `feat`、`fix`、`refactor`、`perf`、`docs`、`test`、`build`、`ci`、`chore` 或 `style` 等标准类型，作用域应简短且对应实际模块。
- 面向开发者的代码注释使用中文；工具识别指令和标识符保留原格式。
- 生成或修改代码后执行 `npm run format`，提交前检查 `npm run format:check`。
- 不提交凭证、本机会话文件和 `.env.local`。真实后端联调默认只读；写入具体业务对象需要用户明确授权。
- 交付时说明验证结果和本次提交。
