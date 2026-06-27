---
name: forge:discovery
hidden: true
description: Use when work needs codebase orientation, impact analysis, existing-pattern discovery, or risk scouting before planning or implementation
---

# Discovery Before Planning

## Overview

Discovery is the explicit "look before you build" gate. Its job is to find the
smallest truthful context needed for planning, not to read the whole repository.

**Core principle:** No non-trivial plan without evidence about existing code,
contracts, callers, and risk surface.

## When To Use

Use `forge:discovery` before `forge:plan`, `forge:subagent`, or direct edits when
ANY are true:

- The change touches 2+ files or a shared type, API, schema, rule, or workflow.
- The task mentions refactor, integrate, harden, optimize, migrate, or best practice.
- You do not know where the relevant implementation already lives.
- A wrong assumption could break callers, security, data, performance, or UX.
- `forge:loop` starts and needs the Discovery step.

Skip or downgrade when ALL are true:

- Single known file, trivial wording/config tweak, and no caller impact.
- The user asked only for conceptual analysis and no code action.
- Prior discovery in this loop is still fresh and covers the same files/contracts.

## Discovery Depth

Choose the cheapest depth that can falsify your assumptions.

| Depth | Use when | Required actions |
|-------|----------|------------------|
| D0 quick | Known file or docs-only change | Read target file plus nearby docs/callers |
| D1 scoped | Multi-file feature/fix | `glob`/`grep` or `codesearch`, read key files, list impact |
| D2 deep | Cross-module, API, DB, security, perf | Add `dep-graph`, `schema-diff`, `dead-code`, or specialist subagent |

Do not run D2 by default. Escalate only when D0/D1 cannot bound the risk.

## Tool Routing

- File names: use `glob`.
- Text patterns: use `grep`.
- Code shapes/call sites: use `codesearch`.
- Module coupling or cycles: use `dep-graph`.
- Public type/API changes: use `schema-diff`.
- Cleanup/refactor candidates: use `dead-code`.
- Broad unfamiliar areas: dispatch `Explore` or `explore` subagent with a focused query.
- Security/auth/payment/PII: dispatch `Guard` or load the security skill before action.
- DB schema/query changes: dispatch `DBA` or use DB-focused tools first.

## Required Output

Discovery must produce this before planning or implementation:

```markdown
Discovery depth: D0 | D1 | D2
Relevant files:
- <path> - why it matters
Existing behavior:
- <observed behavior or pattern, with file:line/tool evidence>
Impact surface:
- <callers/contracts/tests/docs likely affected>
Constraints:
- <rules, conventions, non-goals, compatibility notes>
Risks:
- <risk level: low|medium|high> - <reason>
Recommended next skill: forge:brainstorm | forge:plan | forge:subagent | forge:tdd | forge:debug | normal flow
```

If evidence is insufficient, say exactly what is missing and either gather it or
block with `forge:ask`. Do not convert guesses into plan requirements.

## Loop Integration

When called from `forge:loop`:

1. Run discovery after Goal/Rubric and before Plan.
2. Add discovery output to `loop-start` or `iteration-N` checkpoint details.
3. On later iterations, re-run only for files/contracts touched by failed rubric items.
4. If discovery finds the task is trivial, downgrade the loop to normal flow and state why.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Reading everything | Start D0/D1 and expand only from evidence |
| Planning from memory | Re-read current files; they may have changed |
| Treating grep hits as understanding | Read the owning file and caller context |
| Ignoring public contracts | Check callers, exports, schemas, and docs |
| Running heavy tools for tiny edits | Downgrade to D0 and preserve speed |
| Skipping risk labels | Mark low/medium/high so verify knows what to test |

## Stop Rule

Discovery ends when the next implementation or planning step can name its relevant
files, constraints, impact surface, and verification targets. If it cannot, discovery
is not done.
