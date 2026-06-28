# Forge 行为 Smoke Test

这份清单用于快速验证 Forge 是否按设计工作：简单任务直达，复杂任务升级到 Structured 或 Loop，并在需要时触发 `ask / brainstorm / verify`。

## 使用方式

每次修改 Forge 控制面、loop skill、subagent 协议后，至少过一遍以下用例。

验证目标：

- 路由是否正确
- `ask / brainstorm / discovery / plan / verify` 是否按条件触发
- 子代理是否只在合适时机被调度
- 状态与检查点是否有明确归属

## 用例 1：简单单文件修复

输入示例：修复单个 Markdown 文件中的标题格式问题。

期望：

- Route = `Direct`
- Forge 可直接读写并做最小验证
- 不应出现无证据的全仓 discovery / 子代理扇出
- 验证应与改动面成比例
- 不应强制进入 `Loop`
- 完成前仍需 `verify`

通过标准：

- Forge.md 明确存在 `Direct Route`
- Forge.md 明确要求完成前走 `forge:verify`

## 用例 2：多文件但边界清晰的实现

输入示例：统一两个 agent 的输出格式，并补一份对应说明文档。

期望：

- Route = `Structured Delivery`
- 应触发 `discovery -> plan -> execute/subagent -> verify`
- 可以调 `Builder / Tester / Reviewer`
- 默认不直接进入重型 loop，除非验证失败或发现高不确定性

通过标准：

- Forge.md 明确存在 `Structured Delivery Route`
- FORGE_GUIDE.md 明确存在 `discovery -> plan -> execute/subagent -> verify`

## 用例 3：需求含糊或需要主人拍板

输入示例：为 Forge 增加新的产品化行为，但目标、范围和优先级不明确。

期望：

- 若问题本质是设计分歧，应先走 `brainstorm`
- 若出现主人决策点，必须通过 `forge:ask` / `question`，不能用普通提问收口
- 不应直接进入实现
- 若有多个方案，应先形成 spec 或决策记录
- 若是无人值守且分歧可逆、低风险、范围内，可记录假设后继续

通过标准：

- Forge.md 明确要求决策与澄清走 `forge:ask`
- Forge.md 明确禁止用 prose question 结束决策回合
- FORGE_GUIDE.md 明确写出 `ask` 与 `brainstorm` 的触发条件

## 用例 4：跨模块、高不确定、可能多轮修复

输入示例：改动 3 个以上文件，涉及控制面、loop、子代理协作和验证规则。

期望：

- Route = `Loop`
- 先建立 `Goal / Scope / Rubric / Budget`
- 若 `verify` 失败，下一轮必须改变策略
- 不允许原地重复同一失败路径
- 未批准的 owner-only 决策不得直接进入执行
- 可逆的设计假设可记录后继续，不应机械中断长时间 loop

通过标准：

- Forge.md 明确存在 `Loop Route`
- Forge.md 明确有 doom-loop discipline 和 verify-failed strategy change
- FORGE_GUIDE.md 明确写出 loop 的 contract 结构
- FORGE_GUIDE.md 明确写出自治继续与 owner decision 的边界

## 用例 5：中断后继续

输入示例：继续上一次没做完的 Forge 重构任务。

期望：

- Route = `Resume`
- 应先读取 `forge-check`
- 不依赖聊天记忆推断状态

通过标准：

- Forge.md 明确存在 `Resume Route`
- Forge.md 与 FORGE_GUIDE.md 都明确 `forge-check` 是恢复事实源

## 用例 6：子代理协作边界

输入示例：先定位问题，再实现，再测试，再审查。

期望：

- `Explore / Detective` 可用于只读定位
- `Builder` 负责实现
- `Tester` 负责测试与验证证据
- `Reviewer / Guard` 负责审查
- 分析可并行，实现默认串行

通过标准：

- Forge.md 明确写出并发规则：analysis 可 fan out，implementation 默认串行
- FORGE_GUIDE.md 明确写出子代理分工与状态职责

## 用例 7：完成声明门禁

输入示例：代理声称“已经完成”或“已经修好”。

期望：

- 必须先过 `forge:verify`
- `tests pass` 不能替代 `rubric pass`
- 必要时还要通过 review/testing gate

通过标准：

- Forge.md 明确存在 `Hard Gate 2 — Verification`
- Forge.md 明确写出 `tests passing alone is not completion`

## 静态验证建议

每次 smoke test 至少检查以下锚点是否仍存在：

- `Direct Route`
- `Structured Delivery Route`
- `Loop Route`
- `Resume Route`
- `forge:ask`
- `forge:brainstorm`
- `forge:verify`
- `forge-check`
- `punchcard`
- `task`

## 通过判定

满足以下条件即可判定本轮静态 smoke test 通过：

- 7 个用例都能在控制面文档中找到明确路由与门禁依据
- `Forge.md` 与 `FORGE_GUIDE.md` 的说法不冲突
- `Loop / Resume / ask / verify / subagent` 的职责边界保持清晰

## 限制说明

这份 smoke test 主要验证**规则层与控制面的一致性**。

若要验证真实运行手感，还需要再做一次交互式行为测试，例如：

- 丢一个简单任务给 Forge，看它是否直接走 `Direct`
- 丢一个模糊需求给 Forge，看它是否先 `ask / brainstorm`
- 丢一个多文件高不确定任务给 Forge，看它是否先建 loop contract
