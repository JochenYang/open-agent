<div align="center">

# Open Agent

### 基于 OpenCode 的 Forge 多代理工程系统

<p>
  <a href="https://github.com/anomalyco/opencode"><img alt="OpenCode" src="https://img.shields.io/badge/OpenCode-Compatible-EC4899?style=flat-square&labelColor=1E293B"></a>
  <a href=".opencode/agents/Forge.md"><img alt="Forge" src="https://img.shields.io/badge/Forge-Powered-B91C1C?style=flat-square&labelColor=1E293B"></a>
</p>

<p>
  <img alt="Forge Skills" src="https://img.shields.io/badge/Forge_Skills-19-7C3AED?style=flat-square&labelColor=1E293B">
  <img alt="Subagents" src="https://img.shields.io/badge/Subagents-9-0EA5E9?style=flat-square&labelColor=1E293B">
  <img alt="Custom Tools" src="https://img.shields.io/badge/Custom_Tools-6-F97316?style=flat-square&labelColor=1E293B">
  <img alt="Plugins" src="https://img.shields.io/badge/Plugins-4-DC2626?style=flat-square&labelColor=1E293B">
  <img alt="MCP Servers" src="https://img.shields.io/badge/MCP_Servers-4-06B6D4?style=flat-square&labelColor=1E293B">
  <img alt="Rules" src="https://img.shields.io/badge/Rules-6-CA8A04?style=flat-square&labelColor=1E293B">
</p>

`Skill 驱动编排` · `专长 Subagent` · `规格化交付` · `证据优先`

[特性](#特性) · [架构](#架构总览) · [Forge Skills](#forge-skills) · [Subagent](#subagent-一览) · [工具与插件](#内置工具与插件) · [快速开始](#快速开始)

</div>

---

**Open Agent** 是一套围绕 OpenCode 构建的工程化多代理体系。核心由 **Forge** 主代理统一编排 **19 个 Forge Skill** 完成 loop → discovery → brainstorm → plan → execute → verify → review → merge 全流程，并按需调度 **9 个专长 Subagent** 处理审查、调试、测试、数据库、性能、部署、代码探索等领域工作；同时附带 **6 个自定义 TS 工具**、**4 个 Plugin**、**4 个 MCP 服务**与 **6 套规则文档**，让一台 OpenCode 即可拥有完整的"产品 → 工程 → 验证 → 交付"流水线。

---

## 特性

- **Skill 驱动编排** — Forge agent 不再硬编码工作流，而是按任务特征动态加载 19 个 Skill；新增工作流 = 加一份 SKILL.md
- **专长子代理可调** — Reviewer / Guard / Tester / Detective / Builder / DBA / Perf / Ops / Explore 九个职责清晰的 subagent，覆盖审查、调试、TDD、实现、数据库、性能、部署、AST 代码搜索
- **规格优先与两阶段评审** — 复杂任务先经 brainstorm 形成 spec，subagent 工作完毕后由 spec-reviewer + code-quality-reviewer 双轨复核
- **证据优先与防侥幸** — `rules/evidence-first.md` 引入 L1–L4 证据分级，所有非显然结论强制标注证据等级与验证路径
- **自带工程工具** — 内置 `dep-graph` / `dead-code` / `schema-diff` / `git-conventions` / `vision` / `codesearch` 六大跨语言静态分析与协作工具
- **任务卡与里程碑** — `punchcard` 跟踪每条 T1/T1.1 任务，`forge-check` 记录 plan-complete / merge-ready 等阶段检查点
- **Mission 自治模式** — 通过 `opencode-mission` 插件可下达带预算的长任务，达成条件后由独立 verify 子代理裁定完成
- **MCP 即插即用** — 默认接入 context7（库文档）、exa（联网检索）、interleaved-thinking（结构化推理）、time-mcp（时间换算）

---

## 架构总览

```mermaid
graph TB
    User(["用户"])

    subgraph Primary["主代理"]
        FG["Forge<br/>spec-driven 编排器<br/>仅调度 skill / subagent"]
        BD["build / plan / general<br/>OpenCode 内置主代理"]
    end

    subgraph Skills["Forge Skills (19)"]
        direction LR
        S1["loop · discovery · brainstorm · resume"]
        S1B["ask · plan"]
        S2["subagent · execute · tdd"]
        S3["verify · review · debug"]
        S4["feedback · parallel · worktree"]
        S5["merge · report · reflect · new-skill"]
    end

    subgraph Subagents["专长 Subagent (9)"]
        direction LR
        YS["Reviewer<br/>代码审查"]
        CS["Guard<br/>安全审查"]
        MJ["Detective<br/>调试定位"]
        JY["Tester<br/>TDD 测试"]
        GJ["Builder<br/>通用实现"]
        JZ["DBA<br/>数据库迁移"]
        XH["Perf<br/>性能分析"]
        DW["Ops<br/>部署运维"]
        EX["Explore<br/>代码探索"]
    end

    subgraph Infra["工具 / 插件 / MCP / Rules"]
        TL["Tools<br/>dep-graph · dead-code · codesearch<br/>schema-diff · git-conventions · vision"]
        PL["Plugins<br/>forge · notification<br/>mission · md-table"]
        MC["MCP<br/>context7 · exa<br/>interleaved-thinking · time-mcp"]
        RL["Rules<br/>character · coding-standards<br/>product-workflow · security<br/>context-compression · evidence-first"]
    end

    User --> FG & BD
    FG -->|skill tool| Skills
    FG -->|task tool (parallel fan-out)| Subagents
    Skills -.->|工作流编排| Subagents

    FG --- Infra

    style FG fill:#B91C1C,color:#fff
    style BD fill:#475569,color:#fff
    style YS fill:#7C3AED,color:#fff
    style CS fill:#DC2626,color:#fff
    style MJ fill:#F97316,color:#fff
    style JY fill:#EF4444,color:#fff
    style GJ fill:#0EA5E9,color:#fff
    style JZ fill:#0891B2,color:#fff
    style XH fill:#CA8A04,color:#fff
    style DW fill:#2563EB,color:#fff
```

---

## Forge Skills

19 个 SKILL.md 散布在 `.opencode/forge-skills/`，由 Forge agent 用 `skill` 工具按需加载。Skill 自带"何时该用 / 何时不该用 / 检查清单 / 反例"四段式说明。

| 阶段   | Skill        | 作用                                                        |
|--------|--------------|-------------------------------------------------------------|
| 探索   | `brainstorm` | 任何需要创意/方案的工作前先跑，输出可签字的 spec             |
| 探索   | `ask`        | 决策、澄清、审批的统一入口；无人值守时自动决策                 |
| 编排   | `loop`       | 自动判断是否启动闭环，定义 rubric，并按 verify 结果 ship 或 iterate |
| 编排   | `resume`     | 从最近 forge-check checkpoint 重建 loop 状态，跨会话续跑，不靠聊天记忆 |
| 探索   | `discovery`  | 计划或实现前探查最小代码切片、影响面、约束与风险               |
| 规划   | `plan`       | 把 spec 拆成多步任务，写成可执行 plan                        |
| 执行   | `subagent`   | 通过 `task` 派发独立 subagent，独立任务同一响应并行发出，强制两阶段评审 |
| 执行   | `execute`    | 在新 session 中执行已写好的 plan，带 review checkpoint       |
| 执行   | `tdd`        | 强制 RED-GREEN-REFACTOR-VERIFY，禁止跳测试                   |
| 执行   | `parallel`   | 2+ 个互不依赖任务的并行调度模板                             |
| 验证   | `verify`     | 声称"完成 / 通过 / 修好"前必须跑的证据采集                  |
| 验证   | `review`     | 主干完成或合并前的综合 review                               |
| 验证   | `debug`      | bug / 测试失败 / 异常行为时优先调用                         |
| 协作   | `feedback`   | 收到 code review 反馈时的核实与回应流程                     |
| 协作   | `worktree`   | 隔离工作区，避免污染当前分支                                 |
| 收尾   | `merge`      | 实现完成、测试通过后选择合并 / PR / 清理                     |
| 收尾   | `report`     | 多次 spec 迭代后合并出最终态报告并沉淀 lesson               |
| 收尾   | `reflect`    | ship 或预算耗尽后复盘失败模式，沉淀改进候选到 checkpoint      |
| 元能力 | `new-skill`  | 新建 / 修改 skill，含 subagent 验证流程                      |

---

## Subagent 一览

由 Forge 通过 `task` 工具调度，不需要用户手动召唤。

| Subagent      | 色相 | 读写 | 专长                                                        | 典型调用               |
|---------------|------|------|-------------------------------------------------------------|------------------------|
| **Explore**   | 青   | 只读 | AST 结构化代码搜索（基于 ast-grep），不分析只定位                | 派专长前的地形情报       |
| **Reviewer**  | 堇   | 只读 | 代码审查（正确性 / 性能 / 并发 / 边界 / 可维护性 / 测试缺口） | 合并前质量门           |
| **Guard**     | 赤   | 只读 | 安全专项（认证 / 授权 / 密钥 / PII / 支付 / 注入 / 访问控制） | 涉及 auth / 支付 / PII |
| **Detective** | 橙   | 只读 | Bug 复现、根因定位、状态分叉追踪、最小修复建议                 | 排查报错、复现          |
| **Tester**    | 红   | 可写 | TDD、补测试、运行验证命令、修复到通过                          | 写测试、回归验证        |
| **Builder**   | 蓝   | 可写 | 范围清晰的通用代码实现、重构、修复执行                        | 普通开发任务           |
| **DBA**       | 青   | 可写 | schema、索引、迁移脚本、回填、数据完整性、回滚                   | 数据库变更             |
| **Perf**      | 黄   | 只读 | 慢查询、N+1、CPU/内存热点、CWV、缓存与复杂度                    | 性能审计               |
| **Ops**       | 蓝   | 可写 | CI/CD、Docker、K8s、Terraform、监控、告警、回滚                   | 部署与基础设施         |

---

## 内置工具与插件

### 自定义工具（`.opencode/tools/`）

| 工具                  | 作用                                                        | 多语言支持                            |
|-----------------------|-------------------------------------------------------------|---------------------------------------|
| **`dep-graph`**       | 模块依赖图、循环依赖检测、耦合热点、架构分层校验               | TS/JS · Python · Go · C# · Rust       |
| **`dead-code`**       | 跨语言无用导出检测（无被依赖模块）                            | TS/JS · Python · Go · C# · Rust · C++ |
| **`schema-diff`**     | git ref 间的类型契约语义对比，区分 BREAKING / SAFE / WARNING | TS/JS · Python · Go · C# · Rust       |
| **`git-conventions`** | 提交信息与分支命名规范校验，返回完整规约文档                 | —                                     |
| **`vision`**          | 调用外部视觉模型识别本地图像                                | 兼容 OpenAI / MiniMax                 |
| **`codesearch`**      | 基于 ast-grep 的 AST 结构化代码搜索（class $NAME / async function $F 等） | TS/JS · Py · Rust · Go · Java · C/C++ · C# · CSS · HTML · 20+ 种 |

### Plugin（`.opencode/plugins/`）

| Plugin                                 | 作用                                                              |
|----------------------------------------|-------------------------------------------------------------------|
| **`forge-plugin.js`**                  | 注入 Forge 体系运行时（`punchcard` / `forge-check` / `forge-skill`） |
| **`notification-plugin.js`**           | 长任务 / mission 完成时本地通知                                   |
| **`opencode-mission.js`**              | Mission 自治模式：下达带 turn/token/wallclock 预算的长任务         |
| **`vision-helper.ts`**                 | `vision` 工具的运行时支持                                         |
| `@franlol/opencode-md-table-formatter` | npm 引入的 Markdown 表格美化器                                    |

### MCP 服务

| 服务                     | 类型   | 作用                                            |
|--------------------------|--------|-------------------------------------------------|
| **context7**             | local  | 任意库的最新文档与代码示例                      |
| **exa**                  | remote | 自然语言联网检索 + 网页正文提取                 |
| **interleaved-thinking** | local  | 显式 thinking → tool_call → analysis 结构化推理 |
| **time-mcp**             | local  | 时区换算、当前时间、周数、相对时间                 |

### 规则集（顶层 `instructions`）

| 规则                     | 摘要                                                        |
|--------------------------|-------------------------------------------------------------|
| `character.md`           | 阿亚酱的角色定位、沟通风格、陪伴要求                          |
| `coding-standards.md`    | 工程基线、不可变量、错误处理、Anti-Rationalization             |
| `product-workflow.md`    | Discovery → Planning → Building → Polish → Handoff 五段交付 |
| `security.md`            | 秘钥管理、事件响应、高风险升级、验证输出契约                   |
| `context-compression.md` | 压缩前三问决策树、必须保留 / 允许压缩清单                    |
| `evidence-first.md`      | L1–L4 证据分级 + 5 步证据流程 + 反猜测清单                  |

---

## 快速开始

### 前置条件

- [OpenCode](https://github.com/anomalyco/opencode) 已安装并可用
- Node.js ≥ 18（运行 npx MCP 与 plugin 依赖）
- 全局配置目录：`~/.config/opencode/`（Linux/macOS）或 `%USERPROFILE%\.config\opencode\`（Windows）

### 安装

**1. 克隆仓库**

```bash
git clone https://github.com/JochenYang/open-agent.git
cd open-agent
```

**2. 复制到 OpenCode 全局目录**

Linux / macOS：

```bash
TARGET=~/.config/opencode

cp opencode.json "$TARGET/opencode.json"
cp tui.json      "$TARGET/tui.json"
cp AGENTS.md     "$TARGET/AGENTS.md"

mkdir -p "$TARGET/agents" "$TARGET/commands" "$TARGET/forge-skills" \
         "$TARGET/plugins" "$TARGET/rules" "$TARGET/themes" "$TARGET/tools"

cp -r .opencode/agents/*        "$TARGET/agents/"
cp -r .opencode/commands/*      "$TARGET/commands/"
cp -r .opencode/forge-skills/*  "$TARGET/forge-skills/"
cp -r .opencode/plugins/*       "$TARGET/plugins/"
cp -r .opencode/rules/*         "$TARGET/rules/"
cp -r .opencode/themes/*        "$TARGET/themes/"
cp -r .opencode/tools/*         "$TARGET/tools/"
```

**2.5 安装 `codesearch` 工具的 ast-grep 依赖**

`codesearch` 通过 `execFile` 调用 `ast-grep` 二进制，**不需要 npm 安装**。挑一个方式装 ast-grep 到本地或系统 PATH：

**方式 A：本地 npm 安装（推荐快速试）**

在**你常用的工作目录**（一般是 `$HOME`）跑一次即可——全局可见：

```bash
cd ~  # 或 cd ~/.config/opencode
npm install @ast-grep/cli
```

**方式 B：系统二进制（推荐跨项目长期使用）**

- macOS:   `brew install ast-grep`
- Windows: `winget install ast-grep`  或  `cargo install ast-grep`
- Linux:   `cargo install ast-grep`  或  distro package manager
- 手动:    <https://github.com/ast-grep/ast-grep/releases>

查找顺序：先看 `cwd/node_modules/.bin/ast-grep`，再查系统 PATH。两个都装了就用第一个。

Windows（PowerShell）：

```powershell
$Target = "$env:USERPROFILE\.config\opencode"

Copy-Item opencode.json "$Target\opencode.json"
Copy-Item tui.json      "$Target\tui.json"
Copy-Item AGENTS.md     "$Target\AGENTS.md"

"agents","commands","forge-skills","plugins","rules","themes","tools" |
  ForEach-Object { New-Item -ItemType Directory -Force "$Target\$_" | Out-Null }

Copy-Item -Recurse .opencode\agents\*       "$Target\agents\"
Copy-Item -Recurse .opencode\commands\*     "$Target\commands\"
Copy-Item -Recurse .opencode\forge-skills\* "$Target\forge-skills\"
Copy-Item -Recurse .opencode\plugins\*      "$Target\plugins\"
Copy-Item -Recurse .opencode\rules\*        "$Target\rules\"
Copy-Item -Recurse .opencode\themes\*       "$Target\themes\"
Copy-Item -Recurse .opencode\tools\*        "$Target\tools\"
```

**3. 配置环境变量**

```bash
# MCP context7 API key（必填，从 https://context7.com 获取）
export CONTEXT7_API_KEY="ctx7sk-xxxxxxxx"

# 自定义 provider 的密钥（按需）
export MINIMAX_API_KEY="your-key"
```

Windows 永久写入：`setx CONTEXT7_API_KEY "ctx7sk-xxxxxxxx"`

**4. 启动并验证**

```bash
opencode
```

进入会话后：

```
/agents
```

应能看到 `forge (primary)` 与 Reviewer / Guard / Detective / Tester / Builder / DBA / Perf / Ops 八个 subagent。

---

## 配置说明

### `opencode.json` 关键字段

```jsonc
{
  "default_agent": "build",        // 默认主代理，可通过 Tab 切到 forge
  "instructions": [                // 顶层规则集，按顺序加载
    "~/.config/opencode/rules/character.md",
    "~/.config/opencode/AGENTS.md",
    "~/.config/opencode/rules/coding-standards.md",
    "~/.config/opencode/rules/product-workflow.md",
    "~/.config/opencode/rules/security.md",
    "~/.config/opencode/rules/context-compression.md",
    "~/.config/opencode/rules/evidence-first.md"
  ],
  "skills": {
    "paths": ["~/.config/opencode/forge-skills"]   // 注册 19 个 SKILL.md
  },
  "mcp": {
    "context7":             { "type": "local",  "command": ["npx","-y","@upstash/context7-mcp","--api-key","{env:CONTEXT7_API_KEY}"] },
    "exa":                  { "type": "remote", "url": "https://mcp.exa.ai/mcp" },
    "interleaved-thinking": { "type": "local",  "command": ["npx","-y","@jochenyang/interleaved-thinking"] },
    "time-mcp":             { "type": "local",  "command": ["npx","-y","time-mcp"] }
  },
  "plugin": [
    "@franlol/opencode-md-table-formatter@0.0.6",
    "./plugins/notification-plugin.js",
    "./plugins/forge-plugin.js",
    "./plugins/opencode-mission.js"
  ],
  "permission": {
    "bash": { "*": "allow", "rm *": "ask", "Remove-Item *": "ask", "git rm*": "ask" },
    "external_directory": "allow"
  }
}
```

### 多代理并发（可选）

开启后台 subagent 并发能力，让 Forge 用 `task background: true` 同时跑只读分析：

- **Windows**：`setx OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS "true"`
- **Linux/macOS**：`export OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`

---

## 项目结构

```
open-agent/
├── opencode.json                # 主配置（instructions / skills / mcp / plugin / permission）
├── tui.json                     # TUI 快捷键
├── AGENTS.md                    # 顶层 agent 入口（角色 + 交互机制）
├── LICENSE                      # MIT
└── .opencode/
    ├── agents/                  # 9 个 agent 定义
    │   ├── Forge.md             #   primary  — spec-driven 编排器
    │   ├── Reviewer.md            #   subagent — 代码审查
    │   ├── Guard.md               #   subagent — 安全审查
    │   ├── Detective.md           #   subagent — 调试定位
    │   ├── Tester.md              #   subagent — TDD 测试
    │   ├── Builder.md             #   subagent — 通用实现
    │   ├── DBA.md                 #   subagent — 数据库迁移
    │   ├── Perf.md                #   subagent — 性能分析
    │   └── Ops.md                 #   subagent — 部署运维
    ├── forge-skills/            # 19 个 SKILL.md（ask/brainstorm/.../worktree）
    ├── tools/                   # 6 个自定义 TS 工具 + parsers/（7 种语言）
    ├── plugins/                 # 4 个 plugin（forge / notification / mission / vision-helper）
    ├── rules/                   # 6 套规则（character / coding-standards / ...）
    ├── themes/                  # 4 套主题（mimo / minimax / mytheme / smoke）
    └── commands/
```

---

## 设计理念

### 三个不可让步的原则

| 原则         | 实现                                                                                    |
|--------------|-----------------------------------------------------------------------------------------|
| **证据优先** | 任何非显然结论必须自标 L1–L4 证据等级；L3/L4 必须给出验证路径（`rules/evidence-first.md`） |
| **职责分离** | Forge 只调度、subagent 只做本职、reviewer 不写代码、ask 不替用户做决定                     |
| **完成定义** | 未跑 verify 不算完成；verify 必须基于验收 rubric 全通过；失败项进入下一轮闭环；两阶段评审未通过不算合格 |

---

## 贡献

欢迎以下形式的贡献：

- **新增 Skill** — 在 `.opencode/forge-skills/<name>/SKILL.md` 添加新流程；参考 `new-skill` 的写法清单
- **优化 Subagent** — 调整 `.opencode/agents/*.md` 的 prompt 与权限边界
- **扩展工具** — 在 `.opencode/tools/` 增加跨语言静态分析工具
- **完善规则** — 在 `.opencode/rules/` 补充工程实践与角色行为规范
- **报告问题** — 提 Issue 描述遇到的问题或建议

提交规范由 `git-conventions` 工具统一管理；请确保 commit message 符合 `<type>(<scope>): <subject>` 的英文 imperative 格式，且不夹带 AI 签名。

---

## 协议

[MIT](./LICENSE) © 2026 JochenYang & open-agent contributors
