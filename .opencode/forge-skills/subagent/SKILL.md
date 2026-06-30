---
name: forge:subagent
hidden: true
description: Use when executing plans through specialized subagents with evidence-gated review loops
---

# Subagent-Driven Delivery

Use fresh subagents to execute bounded tasks while Forge keeps the plan, state, and
quality gates. Each subagent should receive a self-contained prompt and return a
structured status.

**Core principle:** specialized subagent + bounded prompt + evidence-gated review =
faster and safer delivery than context-heavy improvisation.

## When To Use

Use `forge:subagent` when:

- a task is not trivial enough for direct controller edits
- a plan already exists or one task boundary is clear
- focused implementation, debugging, testing, or review work can be delegated
- you want isolated execution context and cleaner checkpoints

Do **not** use it for one-line obvious fixes, or before the task boundary is clear.

## Subagent Routing

Prefer specialized agents over `general`.

| Need | Preferred subagent |
| --- | --- |
| Root-cause analysis | `Detective` |
| TDD, regression, command-based verification | `Tester` |
| Bounded implementation or small refactor | `Builder` |
| Correctness / maintainability review | `Reviewer` |
| Security review | `Guard` |
| Schema / migration / query work | `DBA` |
| Performance analysis | `Perf` |
| Build / runtime / release concerns | `Ops` |
| No specialized fit | `general` |

Use `general` only when no specialized agent cleanly matches the work.

## Complexity Routing

| Complexity | Controller action |
| --- | --- |
| `trivial` | edit directly, run focused verification, record reason |
| `standard` | dispatch one specialized subagent, then targeted review |
| `complex` | dispatch specialized implementer, spec review, code-quality review, and re-review loop as needed |

Treat cross-module contracts, schema changes, security-sensitive work, and user-facing
flows as `complex` unless evidence proves otherwise.

## Concurrency Rules

### Safe to fan out in one response

- read-only discovery
- independent review tasks
- independent bug triage on disjoint files
- isolated implementation tasks with proven file non-overlap and no shared contract

### Default to serialize

- implementation on the same feature or contract
- tasks touching the same file
- migrations and release work
- verify-failed repair loops

Rule of thumb: **parallelize analysis, serialize implementation**.

## Controller Responsibilities

Forge remains responsible for:

- choosing the subagent
- deciding serial vs parallel execution
- providing full context and scope boundaries
- tracking work-items with `punchcard`
- persisting loop state with `forge-check`
- running or requiring the final verification gate

The `task` tool is not your task tracker. Use `punchcard` for T1/T1.1 work-items.

## Prompt Contract For Every Dispatch

Every dispatched subagent prompt should contain:

1. **Goal** — the exact outcome for this task
2. **Scope** — which files / modules may change
3. **Non-goals** — what must not change
4. **Context** — relevant file excerpts, spec sections, errors, and constraints
5. **Verification expectation** — tests, commands, or review evidence required
6. **Output contract** — `Status`, result, evidence, risks, next recommendation
7. **Relevant forge skill hint** — e.g. "follow `forge:tdd`"

Do not make the subagent discover the plan or intent from scratch if you already know it.

## Per-Task Process

1. Read the task boundary and supporting context.
2. Decide direct edit vs subagent dispatch based on complexity.
3. Create / start the work-item in `punchcard`.
4. Dispatch the specialized subagent with a self-contained prompt.
5. Handle the returned `Status`.
6. If implementation work occurred, run the review loop.
7. Mark the work-item done only after the relevant review / verify gate passes.
8. **Write back to the plan file** — flip the task's `- [ ]` checkbox to `- [x]` and
   append a line to the plan's `## Execution Progress` section (see `forge:plan`'s
   "Living Plan Document" contract). The line MUST include: commit SHA, verify
   verdict, ISO-8601 timestamp. If the task is iterating on a verify failure, leave
   the checkbox `- [ ]` and append an `iteration-N` line to `## Loop Trace` instead.

Skipping the writeback is a false completion — the task is not "done" until the plan
document reflects the verify-pass state.

## Handling Returned Status

Subagents must report one of:

- `DONE`
- `DONE_WITH_CONCERNS`
- `NEEDS_CONTEXT`
- `BLOCKED`

### `DONE`

- proceed to review or verification

### `DONE_WITH_CONCERNS`

- read the concerns first
- if correctness or scope is in doubt, resolve before review
- if concerns are low-risk observations, note them and continue

### `NEEDS_CONTEXT`

- provide the missing context
- re-dispatch with the updated prompt

### `BLOCKED`

- change something real before retrying: context, task split, subagent, or strategy
- if the blocker needs owner input, use `forge:ask`

Never force the same blocked subagent to retry with the same prompt.

## Review Loop

### Phase 1: spec / intent compliance

After implementation, review against the task intent first.

- use covered spec / plan intent + diff evidence
- do not accept prose without evidence
- any in-scope `fail` or `unverifiable` item sends the task back for repair

### Phase 2: code quality review

Once the spec gate passes, review for:

- correctness gaps not covered by the spec
- maintainability
- performance footguns
- test completeness

If review finds issues, re-dispatch the implementer with exact failing claims and then
re-review. Do not move on with open review findings.

## Verification Handoff

Subagent success does not equal task completion.

- implementation subagents may run targeted tests
- Forge still owns the route-level completion gate
- `forge:verify` remains the final pass/fail authority for delivery claims

## Tool Edit Fallback

When edit attempts fail due to context mismatch, use this order:

1. re-read the exact file range
2. try a smaller anchored edit
3. try a narrower multi-line edit
4. rewrite the full file only if it is small and freshly read
5. ask or re-split the task if the safe path is unclear

Do not repeat the same failed edit pattern more than twice.

## Dispatching Subagents — Tool Reference

Use the OpenCode `task` tool exactly as supported:

```text
task(
  description: <3-5 word summary>,
  prompt: <full prompt text>,
  subagent_type: <agent name>,
  task_id: <optional existing subagent session>,
  background: <optional true/false>
)
```

- prefer foreground tasks for work needed before continuing
- use `background` only for truly independent long-running work
- do not poll or duplicate a background task's work

## Red Flags

Never:

- default to `general` when a specialized subagent fits
- dispatch implementation subagents in parallel on overlapping scope
- make subagents rediscover a spec you already have
- skip re-review after issues were found
- treat subagent prose as evidence
- confuse `task` with `punchcard`
- mark a task complete while in-scope review claims still fail or are unverifiable

## Bottom Line

Forge is the lead. Subagents are the team.

Delegate execution aggressively, but delegate with explicit boundaries, explicit
evidence requirements, and explicit review gates.
