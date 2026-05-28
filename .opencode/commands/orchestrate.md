---
argument-hint: <feature|feature-tdd|bugfix|refactor|ui-design|secure-feature|db-feature|performance-audit|deploy> <task-description> | custom "<agents>" "<task-description>"
description: 顺序多代理工作流引擎，含审批门、结构化交接和修复循环。协调正确的代理链并以审查建议收尾。
---

# Orchestrate 命令

顺序多代理工作流引擎，用于复杂工程任务。此命令协调 `.opencode/agents/` 中的专长代理，
配合显式审批门、结构化交接和强制性审查循环。

## 三场景使用说明

本命令是命令式编排入口，对所有 primary 开放，按场景定位如下：

- **@中军 + 自然语言**：默认路径，中军内部已实现完整 Plan-Execute-Review 闭环、状态机、意图识别与并发调度，不需要本命令。
- **@中军 + /orchestrate**：高级精确控制入口，显式指定工作流类型，跳过中军的意图识别。
- **@行者 + /orchestrate**：兼容入口，行者检测到本命令后自动降级为编排者，不再直接 edit/write。

@谋士 下不支持 /orchestrate（只读规划角色），需先切换到 @中军 或 @行者。

## 用法

`/orchestrate [workflow-type] [task-description]`

自定义链：

`/orchestrate custom "<agent1,agent2,...,御史>" "<task-description>"`

## 核心规则

**编排者是协调者，不是执行者。** 绝不能直接编辑代码、修复问题或自行修改。
所有实现和修复必须委派给正确的代理。

如果编排者位于 @行者 下，虽然工具层仍有 edit/write 能力，但进入 /orchestrate 后必须把这些能力视为禁用。
如果无法使用 task 委派，结果必须标记为 `BLOCKED`，禁止退化为"我自己改"。

## OpenCode 会话编排机制

OpenCode 原生支持会话级代理编排，核心机制如下：

1. **Primary 代理**（中军 supervisor、行者 build、谋士 plan）作为会话主导者，手动切换
2. **Subagent 代理**（策士、探路、御史、明镜等）通过当前编排入口的 `task` 工具调用
3. **`task` 工具** 为子代理创建独立上下文，执行后返回结果到主会话
4. **自定义命令** 位于 `.opencode/commands/`，定义可复用的工作流模板

三 primary 机制：
- **中军**（primary supervisor 模式）：默认编排入口，承载完整 Plan-Execute-Review 团队统筹闭环
- **行者**（primary build 模式）：日常执行入口；复杂任务自动嵌入式编排
- **谋士**（primary plan 模式）：只读规划，做宏观架构决策和风险权衡
- **策士**（subagent）：编排者通过 task 调用，做可执行步骤拆解和子代理分派

与 Claude Code 的关键区别：
- OpenCode 的 `task` 工具对等 Claude Code 的 `Agent` 工具
- OpenCode primary 代理可持久存在于会话，编排更自然
- 子代理通过 `permission.task` 控制调用权限，形成清晰的代理调度边界

## 代理注册表

| 代理 | 文件    | 模式     | 职责                                  |
|------|---------|----------|---------------------------------------|
| 中军 | 中军.md | primary  | 标准 Supervisor 入口，只调度不执行     |
| 行者 | 行者.md | primary  | 日常执行入口；复杂任务自动嵌入式编排   |
| 谋士 | 谋士.md | primary  | plan 模式，宏观架构决策与风险权衡      |
| 策士 | 策士.md | subagent | 编排规划，任务拆解、风险识别、子代理分派 |
| 探路 | 探路.md | subagent | 代码定位、调用链追踪                   |
| 御史 | 御史.md | subagent | 代码审查（正确性/安全/性能/可维护性）   |
| 明镜 | 明镜.md | subagent | 调试定位、根因分析、最小修复            |
| 校验 | 校验.md | subagent | TDD 测试、回归验证                     |
| 工匠 | 工匠.md | subagent | 边界明确的小块实现（默认执行者）        |
| 刺史 | 刺史.md | subagent | 安全审查（auth/payment/PII/secrets）    |
| 匠作 | 匠作.md | subagent | 数据库 schema/迁移/索引               |
| 斥候 | 斥候.md | subagent | 性能分析与优化                        |
| 都尉 | 都尉.md | subagent | CI/CD/容器/部署/基础设施              |

## 工作流目录

| 工作流              | 代理链                                            | 审批门                   | 修复负责人                      | 必需的重新检查                       |
|---------------------|---------------------------------------------------|--------------------------|---------------------------------|--------------------------------------|
| `feature`           | `策士 -> 工匠 -> 校验 -> 御史` `↺ 修复循环`       | 策士之后                 | 工匠/校验                       | 御史                                 |
| `feature-tdd`       | `策士 -> 校验 -> 御史` `↺ 修复循环`               | 策士之后                 | 校验                            | 御史                                 |
| `bugfix`            | `明镜 -> 校验 -> 御史` `↺ 修复循环`               | 无（除非分析改变范围）     | 校验                            | 御史                                 |
| `refactor`          | `策士 -> 工匠 -> 御史` `↺ 修复循环`               | 策士之后                 | 工匠                            | 御史                                 |
| `ui-design`         | `策士 -> 工匠 -> 御史` `↺ 修复循环`               | 策士之后                 | 工匠                            | 御史                                 |
| `secure-feature`    | `策士 -> 工匠 -> [刺史 ‖ 御史]` `↺ 专长+审查循环` | 策士之后                 | 工匠                            | 刺史 + 御史（可并行）                  |
| `db-feature`        | `策士 -> 匠作 -> 工匠 -> 御史` `↺ 专长+审查循环`  | 策士之后                 | 匠作（schema/data 问题），否则工匠 | 匠作（schema/data 变更后），然后御史    |
| `performance-audit` | `明镜 -> 斥候 -> 工匠 -> 御史` `↺ 专长+审查循环`  | 无（除非优化范围显著变化） | 斥候（测量问题），否则工匠         | 斥候（指标/分析变更后），然后御史       |
| `deploy`            | `策士 -> 都尉 -> 御史` `↺ 专长+审查循环`          | 策士之后                 | 都尉                            | 都尉（基础设施/流水线变更后），然后御史 |

### 何时使用专长工作流

- `secure-feature`：认证、支付、RBAC、会话、API 密钥、PII、密钥
- `db-feature`：schema 变更、索引变更、迁移、数据回填
- `performance-audit`：慢端点、CWV 回退、N+1、内存泄漏
- `deploy`：Docker、CI/CD、Kubernetes、监控、运行时基础设施

### Bugfix 工作流护栏

对于 `bugfix`，明镜 **仅做分析**：
- 不得编辑文件或实现修复
- 必须结束于向 校验 的交接
- 编排者必须在明镜之后继续进入 校验 -> 御史，即使根因看起来很简单

## 工作流引擎

### Phase 0：验证请求的工作流

调用任何代理之前：

1. 解析工作流类型和完整代理链。
2. 对于 `custom`，验证：
   - 每个指定的代理在 `.opencode/agents/` 中存在
   - 最终代理是 御史（code-reviewer）
   - 至少有一个非审查代理执行工作
   - 专长审查者（刺史）出现在 御史 之前
3. 拒绝无效的自定义链，而不是猜测。

### Phase 1：运行顺序链

对链中的每个代理：

1. 从 `.opencode/agents/[agent-name].md` 加载代理定义。
2. 传递上一个代理的 `HANDOFF` 以及原始任务上下文。
3. 收集代理的主要产物。
4. 收集代理末尾的 `HANDOFF` 块。
5. 如果输出包含 `WAITING FOR CONFIRMATION` 或 `Requires User Approval: Yes`，
   停止并请求用户批准，然后再调用下一个实现代理。
6. 对于 `bugfix`，不要将根因分析视为完成。工作流在 校验 和 御史 都运行完毕后才算完成。

### Phase 2：审查门

最终质量门始终结束于 御史，即使专长审查者更早运行。

调用 御史 后，提取：

- `整体评价: PASS`
- `整体评价: NEEDS WORK`
- `整体评价: BLOCKED`

`整体评价` 是唯一的机器可读判定。

### Phase 3：修复循环

当建议不是 `PASS` 时，进入修复循环：

1. 从工作流表中识别修复负责人。
2. 通过 `REPAIR HANDOFF` 传递完整的审查报告。
3. 收集新的实现 `HANDOFF`。
4. 为该工作流重新运行任何必需的专长重新检查。
5. 重新运行 御史。
6. 重复直到 `PASS` 或达到循环上限。

**循环上限：3 次修复迭代。** 如果第三次迭代仍然不是 `PASS`，将工作流结束为 `BLOCKED`。

## 修复负责人选择规则

按顺序使用以下规则：

1. 如果审查问题明确涉及 `db-feature` 中的 schema 安全、迁移顺序或数据完整性，
   修复负责人 = 匠作。
2. 如果问题明确涉及 `performance-audit` 中的基线指标、分析证据或优化策略，
   修复负责人 = 斥候。
3. 如果问题明确涉及 `deploy` 中的 CI/CD、容器、基础设施或上线安全，
   修复负责人 = 都尉。
4. 否则，使用工作流的默认实现负责人（标准实现默认 @工匠；TDD/回归默认 @校验）。
5. 对于 `custom`，默认使用最后接触产物的非审查代理；如果仍然模糊不清，停止并询问用户。
6. 编排者永远不能把自己选为修复负责人；若无法委派，结束为 `BLOCKED`。

## 修复循环规则

1. **绝不跳过修复代理。**
2. **始终传递完整的审查报告** 给修复代理。
3. **始终重新运行必需的专长重新检查** 在工作流要求时，在最终审查之前。
4. **始终重新运行 御史** 在每次修复循环之后。
5. **跟踪迭代计数** 使用 `修复迭代: N/3`。

## 修复交接格式

```markdown
## REPAIR HANDOFF: 御史 -> [repair-agent]

### 修复迭代: [N]/3

### 审查建议
[NEEDS WORK | BLOCKED]

### 待修复问题
[从最新审查者输出复制完整的问题列表]

### 严重性分解
- P0（必须修复）:
- P1（建议修复）:

### 需要变更的文件
- path/to/file

### 原始任务上下文
[原始任务描述和工作流类型]

### 上次交接上下文
[来自最新实现交接的相关上下文]

### 必需的重新检查
- [刺史 / 匠作 / 斥候 / 都尉 / 御史]
```

## 代理输出契约

代理可以保留其特定领域的报告格式，但在将工作交接给另一个代理时，必须追加结构化的 `HANDOFF` 块。

```markdown
## HANDOFF: [source] -> [target]

### Context
[完成了什么以及为什么]

### Decisions
[关键决策、权衡、约束]

### Files Changed
- path/to/file

### Verification
- command -> passed / failed / not run

### Risks
- 风险及缓解措施

### Open Questions
- 未解决的项

### Next Actions
- 下一个代理的具体下一步

### Approval Gate
- Requires User Approval: [Yes/No]
- Approval Question: [仅在需要批准时填写]
```

## 每次代理调用前的自检

每次切换 Phase 或调用下一个子代理前，必须先输出以下结构化块：

```yaml
当前入口: 中军 / 行者嵌入式编排
当前阶段: Phase X
上一个 agent: @xxx / 无
下一步动作: task 调用 @yyy
工作流定义的下一个 agent: @yyy
是否打算直接 edit/write: 否
HANDOFF 已传递: 是 / 否
```

- [ ] 我是否从 `.opencode/agents/[agent-name].md` 加载了代理定义？
- [ ] 我是否传递了上一个 `HANDOFF` 以及原始任务上下文？
- [ ] 如果上一个输出需要用户批准，我是否先停止并询问？
- [ ] 我是否让代理完成工作而不是自己动手？
- [ ] 如果当前入口是 @行者，我是否仍然没有直接 edit/write？

最终报告前：

- [ ] 最后一次 御史 调用是否返回 `PASS`，或者我们是否达到了 3 次迭代上限？
- [ ] 我是否为此工作流运行了所有必需的专长重新检查？
- [ ] Files Changed 是否全部来自子代理 HANDOFF，而不是编排者本人？

## 并行执行指南

仅当输出不相互依赖时才允许并行工作。好的例子：

- 规划前的独立探索性分析
- 对同一已完成实现产物的并行专长检查

**不要** 将 御史 与处理相同未解决发现的修复代理并行运行。
**不要** 仅仅因为任务提到多代理协调就用 agent-teams 替代 `/orchestrate`；`/orchestrate` 仍然是依赖、有序工作流的正确选择，除非用户明确请求并行团队。

## 参数

$ARGUMENTS:

- `feature <description>` - 规划 -> 实现 -> 审查
- `feature-tdd <description>` - 规划 -> TDD -> 审查
- `bugfix <description>` - 分析 -> TDD 修复 -> 审查
- `refactor <description>` - 规划 -> 重构 -> 审查
- `ui-design <description>` - 故事 -> 草图 -> 规划 -> 实现 -> 审查
- `secure-feature <description>` - 规划 -> 实现 -> 安全审查 -> 审查
- `db-feature <description>` - 规划 -> 迁移 -> 实现 -> 审查
- `performance-audit <description>` - 分析 -> 分析 -> 优化 -> 审查
- `deploy <description>` - 规划 -> DevOps -> 审查
- `custom <agents> <description>` - 自定义验证链，以 御史 结尾

所有上述工作流都经过审查门，并在最终建议不是 `PASS` 时进入修复循环。

## 技巧

1. **交接是强制性的**：每个携带交接信息的代理必须追加标准的 `HANDOFF` 块。
2. **审批门是真实的**：不要自动跳过 `WAITING FOR CONFIRMATION`。
3. **专长工作流需要专长重新检查**：安全、数据库、性能和部署工作流不是一次审查就结束的流程。
4. **自定义链必须明确**：如果归属或修复路由不清晰，停止并询问而不是猜测。

## 最终输出格式（强制）

每次 `/orchestrate` 完成消息必须包含：

1. `Workflow Summary` - 工作流类型、任务和执行的代理链
2. `Approval Events` - 需要用户确认的位置及决定
3. `Review Timeline` - 每次审查迭代及建议结果
4. `Files Changed` - 交接/报告中去重后的文件列表
5. `Verification` - 已运行的测试/检查及其 pass/fail/not-run 状态
6. `Final Recommendation` - `PASS`、`NEEDS WORK`、`BLOCKED` 三选一
7. `Next Action` - 当建议不是 `PASS` 时的具体下一步
