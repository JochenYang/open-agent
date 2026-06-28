# Forge 设计与使用说明

这份文档说明 Forge 作为主代理时的控制面职责、路由规则，以及 `ask / brainstorm / discovery / plan / verify` 与子代理之间的协作关系。

## Forge 的定位

Forge 不是“万能执行代理”，而是一个人的专业开发团队控制面。

- Forge 负责：目标澄清、路由判断、状态推进、证据门禁、最终交付
- 子代理负责：按专长执行局部任务
- skills 负责：把常见工作流做成可复用流程片段

一句话：**Forge 管全局，loop 管节奏，subagent 管分工。**

## 四种主路由

### 1. Direct

适合：

- 单文件或很小改动
- 需求清晰
- 一轮验证即可判断结果

流程：

`read smallest context -> edit -> proportional verify -> report`

Direct 的额外约束：

- 只读最小必要上下文
- 不做无证据的全仓 discovery
- 验证强度必须与改动面成比例
- 一旦出现开放设计分歧、主人决策点或多重门禁，立即升级

### 2. Structured Delivery

适合：

- 多步骤但边界清晰
- 涉及 2+ 文件
- 可能需要 Builder、Tester、Reviewer 协作

流程：

`discovery -> plan -> execute/subagent -> verify`

### 3. Loop

适合：

- 复杂或高不确定任务
- 容易第一次做错
- 需要“修复 -> 验证失败 -> 改策略 -> 再试”

流程：

`goal -> rubric -> execute -> verify -> iterate or stop`

Loop 必须包含：

- Goal
- Scope
- Non-goals
- Rubric
- Budget
- Stop conditions

### 4. Resume

适合：

- 任务中断后续跑
- 需要跨会话恢复 loop 状态

恢复以 `forge-check` 为准，不依赖聊天记忆。

## 控制原则：硬边界，软路由

Forge 不是靠关键词硬触发，而是靠**语义边界**治理。

### 硬边界

- 需要主人决策/批准/澄清 → `forge:ask`
- 存在会实质改变实现方向的开放设计空间 → 先 `forge:brainstorm`
- 要宣称完成 → 必须 `forge:verify`
- `verify` 失败后下一轮必须换策略，不能原地重试同一路径

### 软路由

- `Direct / Structured / Loop / Resume` 是默认路线，不是关键词开关
- 允许基于证据升级或降级
- 路由判断基于任务性质，不基于字面触发词

## ask / brainstorm / discovery / plan / verify 何时触发

### ask

用于决策缺口，是**主人决策协议**，不是单纯的聊天提问。

常见触发：

- 需求边界不清
- 有多个可行方案且代价不同
- 需要主人批准风险、范围或方向

补充原则：

- 不能用普通自然语言问题代替 `forge:ask`
- 若无人值守且决策可逆、低风险、范围内，可按最小安全方案继续
- 只有不可逆、高风险、越界决策才真正进入阻塞

### brainstorm

用于收敛设计空间，而不是给所有任务强行加前置流程。

常见触发：

- 需求模糊
- 要先比较方案
- 要把“想法”收敛成可执行规范

补充原则：

- 只有当设计分歧会实质改变后续实现时，才必须进入 `brainstorm`
- `brainstorm` 的出口若涉及主人拍板，必须进入 `forge:ask`
- 若 discovery 已证明设计空间其实已关闭，应退出 brainstorm，回到 Direct / Plan / Loop

### discovery

用于实现前的最小上下文收集。

常见触发：

- 不确定影响面
- 需要确认调用链、边界条件、现有模式
- 准备决定是否进入 plan 或 loop

补充原则：

- discovery 解决的是信息缺口，不是审批缺口
- 发现问题本质是“需要决策”而不是“缺证据”时，应停止 discovery，转 `brainstorm` 或 `ask`

### plan

用于把非 trivial 工作拆成可执行步骤。

常见触发：

- 涉及多个文件或多个角色
- 需要明确依赖关系和验证方式
- 需要串行/并行安排

### verify

用于完成声明前的硬门禁。

必须触发的场景：

- 声称“完成”
- 声称“修好了”
- 声称“可以交付”

`verify` 判断的是是否满足 rubric，而不是仅仅“命令跑过了”。

## 自治与阻塞的边界

Forge / Loop 默认应尽量持续推进，不因普通小决策频繁停机。

可自治继续：

- 命名
- 局部实现形态
- 测试组织
- 已批准方向下的最小安全选择

应阻塞并进入 owner decision：

- 不可逆或破坏性动作
- 超出已批准范围
- 新增依赖、外部服务、部署副作用
- 安全 / 隐私 / 数据迁移权衡
- 会显著改变产品/架构方向的分叉

## 子代理与 loop 的关系

子代理不是 loop，loop 也不是子代理。

- 子代理：负责具体专长执行
- loop：负责失败后的继续、停止或换策略

典型关系：

- Forge 进入 loop
- loop 中调用 Builder 实现
- 调 Tester 做验证
- 调 Reviewer / Guard 做审查
- 根据 verify 结果决定继续还是停止

## 子代理使用原则

### 优先专长代理

- Explore：定位，不分析
- Detective：根因定位
- Builder：实现与最小改动
- Tester：TDD、测试、验证
- Reviewer：正确性/维护性审查
- Guard：安全审查
- DBA：数据库与迁移
- Perf：性能分析
- Ops：部署与基础设施

### 并发策略

- 只读分析可以并行
- 实现类任务默认串行
- 当多个改动可能冲突时，优先串行

## 状态职责

三类状态各司其职：

- `forge-check`：loop/checkpoint 的事实源
- `punchcard`：任务项、子任务、里程碑跟踪
- `task`：子代理执行会话

不要用聊天记忆替代 checkpoint，也不要把 `task` 当成任务管理器。

## 子代理标准返回

Forge 期待子代理返回统一状态：

- `DONE`
- `DONE_WITH_CONCERNS`
- `NEEDS_CONTEXT`
- `BLOCKED`

并附带：

- Summary
- Evidence
- Risks / Needs（按需）

这样 Forge 才能稳定做下一跳判断，而不是靠猜自然语言。

## 何时直接做，何时升级

可直接做：

- 单点小改
- 验证路径短
- 风险低

应升级到 Structured 或 Loop：

- 需求不清
- 影响面大
- 涉及多角色协作
- 容易多轮失败
- 需要 checkpoint 恢复

## 一条最重要的使用原则

**简单任务不要过度流程化，复杂任务不要凭感觉推进。**

Forge 的价值不在于“把每件事都搞复杂”，而在于：

- 该直达时直达
- 该拆分时拆分
- 该闭环时闭环
- 该让子代理干活时，自己只做控制与判断
