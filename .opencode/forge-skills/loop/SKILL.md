---
name: forge:loop
hidden: true
description: Use when work needs an explicit delivery contract, iterative repair, bounded autonomy, or resume-safe state
---

# Closed-Loop Delivery

## Overview

Forge loop turns a request into a bounded engineering cycle with explicit state.

**Core principle:** a loop is not "keep trying". A loop has a contract, evidence,
budget, checkpoints, and stop conditions.

Loops are autonomous by default. They should keep moving unless an owner-only decision or a real external blocker makes safe continuation impossible.

## When To Start A Loop

Start `forge:loop` when ANY are true:

- the task has 2+ steps, 2+ files, or cross-module effects
- success depends on multiple commands, reviews, or gates
- requirements need an explicit acceptance rubric
- verification may fail and require another pass
- subagents will be used for execution or review
- the user asks for end-to-end delivery, hardening, or best-practice implementation

Do **not** start a loop when ALL are true:

- trivial single-file wording or formatting change only
- one focused verification command is enough
- the user explicitly wants analysis or planning only

If unsure, start the loop and downgrade explicitly.

## Loop Contract

Before execution, establish this contract in your working context and persist it with
`forge-check` for non-trivial work:

```markdown
Goal: <user outcome>
Scope:
- <what this iteration may change>
Non-goals:
- <what this iteration will not change>
Rubric:
- [ ] <objective acceptance criterion>
- [ ] <constraint, risk gate, or non-goal>
Budget:
- max_fix_iterations: 3
- used_fix_iterations: 0
- remaining_fix_iterations: 3
Stop conditions: pass | blocked | budget_exhausted | owner_decision_required
```

Rubric items must be verifiable by command output, file evidence, reviewer verdicts,
screenshots, logs, or explicit owner approval.

## Approval-First Loop Entry

When the user asks for route selection, a loop contract, or approval before any modification:

1. gather only the smallest evidence needed to justify the route and contract
2. output the route, why not the lighter route when relevant, the loop contract, and one highest-priority owner decision
3. stop and wait for approval
4. defer full discovery, planning, dispatch, and execution until approval is granted, unless no user is available and `forge:ask` rules allow autonomous continuation

This applies even when the truthful route is clearly Loop.

## The Loop

1. **Goal** — restate the requested outcome and boundary.
2. **Scope / non-goals** — prevent scope creep up front.
3. **Rubric** — define the acceptance gate before implementation.
4. **Discover** — after contract approval, invoke `forge:discovery` for non-trivial work, or record why it was skipped.
5. **Plan** — invoke `forge:plan` when multiple tasks or milestones exist.
6. **Execute** — use `forge:subagent`, `forge:tdd`, `forge:debug`, or direct work for trivial cases.
7. **Verify** — invoke `forge:verify`; verdict must be `pass`, `fail`, or `blocked`.
8. **Iterate or ship** — `pass` ships; `fail` creates the next iteration prompt; `blocked` asks or stops.

## Failure Handling Rules

When verification fails:

1. Increment `used_fix_iterations`.
2. Convert failed rubric items into the next implementation prompt.
3. Preserve already-passing rubric items.
4. Change at least one variable: prompt, context, task split, subagent, implementation strategy, or verification path.
5. Re-run verification after the fix.

Do **not** repeat the same failed strategy with the same evidence.

If `used_fix_iterations >= max_fix_iterations`:

- do not keep thrashing
- use `forge:ask`, downgrade scope, or stop with `budget_exhausted`
- invoke `forge:reflect` when the loop closes

## Brainstorm Boundary

- If open design space materially changes implementation direction, converge it through `forge:brainstorm` before `execute`.
- `forge:ask` is a decision protocol, not an automatic human-blocking pause. If no owner is available and the choice is reversible, in-scope, and low-risk, choose the smallest safe option, record it in the contract/checkpoint, and continue.
- Escalate to `owner_decision_required` only for irreversible, high-risk, or out-of-scope decisions that cannot be safely auto-resolved.
- If requirements are already clear enough to define a truthful rubric, derive the rubric directly and keep the loop moving.
- Do not let pre-approval discovery grow into implementation-level analysis. Before approval, discovery only exists to support route truthfulness, contract truthfulness, and the immediate decision checkpoint.

## Memory Checkpoints

`forge-check` is the durable loop memory. Use it at minimum for:

- `loop-start`
- every `verify-failed`
- every major `iteration-N`
- `ship-ready`

Checkpoint schema:

```json
{
  "stage": "loop-start | iteration-N | verify-failed | ship-ready",
  "mode": "direct-downgraded | structured | loop",
  "goal": "<user outcome>",
  "scope": ["<allowed change area>"],
  "non_goals": ["<not changing>"],
  "rubric": [
    {
      "id": "R1",
      "text": "<criterion>",
      "status": "pending | pass | fail | blocked | out-of-scope",
      "evidence": "<command/reviewer/file:line>"
    }
  ],
  "discovery": {
    "depth": "D0 | D1 | D2",
    "files": ["<path>"],
    "impact_surface": ["<caller/contract/test/doc>"],
    "risk": "low | medium | high"
  },
  "budget": {
    "max_fix_iterations": 3,
    "used_fix_iterations": 0,
    "remaining_fix_iterations": 3
  },
  "current_stage": "discover | plan | execute | verify | iterate | ship",
  "current_task": "<what is being done now>",
  "next_action": "ship | iterate | ask | block | downgrade",
  "last_failure": "<why the previous pass failed>",
  "strategy_change": "<what changed this pass>",
  "blockers": ["<reason>"],
  "residual_risks": ["<risk>"]
}
```

Do not rely on chat memory for any field another session will need.

## Resume Protocol

If the user asks to continue or resume:

1. call `forge:resume`
2. reconstruct goal, rubric, budget, blockers, and next action from `forge-check`
3. continue from `next_action`
4. only re-run discovery or planning if the checkpoint is stale or missing required state

## Iteration Prompt Pattern

Write iteration prompts from evidence, not vibes:

```markdown
Continue the loop for <goal>.
Failed rubric items:
- <item> — evidence: <command/reviewer/file output>
Preserve:
- <already passing items>
Constraints:
- stay within <scope>
- do not expand beyond <non-goals>
Strategy change this pass:
- <what is different now>
Required verification:
- <commands/review checks>
```

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Starting implementation without a rubric | Define the loop contract first |
| Treating tests as the whole gate | Include requirements, review, and risk criteria |
| Asking "should I continue?" after a fail | Iterate automatically unless blocked |
| Repeating the same fix attempt | Change strategy based on failure evidence |
| Keeping state only in chat | Write `forge-check` checkpoints |
| Letting the loop run forever | Enforce budget and stop conditions |

## Relationship To Other Skills

- **Before loop:** `forge:brainstorm` when requirements are ambiguous
- **Inside loop:** `forge:discovery`, `forge:plan`, `forge:subagent`, `forge:tdd`, `forge:debug`
- **Loop gate:** `forge:verify`
- **After close:** `forge:report`, `forge:merge`, `forge:reflect`

If another skill has a stricter rule, follow the stricter rule.
