---
name: forge:reflect
hidden: true
description: Use after a loop ships or after verify fails repeatedly at budget — captures failure patterns and improvement candidates so the next loop starts smarter
---

# Loop Retrospective

## Overview

Reflection turns a finished or stalled loop into reusable knowledge. Without it,
the same failure mode costs the next loop the same iterations. With it, forge
gets incrementally better at the kinds of tasks this project actually has.

**Core principle:** Reflect is cheap, bounded, and writes its output down — it is
not a feelings dump. Every reflection must end with a concrete candidate: a rule
edit, a skill tweak, or an explicit "nothing to change" verdict.

## When To Use

Run `forge:reflect` at these points:

- **After ship-ready** (loop reached `pass`): lightweight, ~1 pass. What surprised
  us? What cost more iterations than expected?
- **After budget exhaustion** (verify failed `max_fix_iterations` times): focus on
  WHY the rubric kept failing — wrong plan, wrong discovery, wrong rubric, or a
  recurring codebase hazard?
- **On explicit request** ("what did we learn here?").

Skip reflect for trivial single-pass loops with no surprises.

## The Reflection

Produce this before stopping:

```markdown
Loop: <goal one-liner>
Outcome: shipped | budget-exhausted | blocked
Iterations used: <N> of <max>
Failure patterns (if any):
- <pattern> — evidence: <which rubric items failed repeatedly and why>
Surprises:
- <what was unknown at loop-start that later mattered>
Root cause of any repeated failure:
- <plan gap | discovery gap | rubric too strict | codebase hazard | model blind spot>
Improvement candidates:
- [ ] <candidate> → target: rules/<file>.md | forge-skills/<skill>/SKILL.md | none
Residual risk:
- <what might still bite us later>
Verdict: <rule edit proposed | skill tweak proposed | nothing to change>
```

## Improvement Candidate Triage

For each candidate, decide:

1. **Rule candidate** — a recurring hazard or convention worth enforcing project-wide.
   Propose the exact rule file and a 1-3 sentence addition. Do NOT write it
   yourself unless the user approves; rules are durable and affect every session.
2. **Skill tweak** — a workflow gap a forge skill should cover. Propose which skill
   and what sentence to add/change.
3. **Nothing to change** — the failure was situational, not systematic. State this
   explicitly so no one chases a non-pattern.

Never propose a change you cannot tie to a specific failed rubric item or a
specific surprise. Vague "we should be more careful" proposals are noise.

## Sinking The Output

Write the reflection to a `forge-check` checkpoint so it survives the session:

```
forge-check(operation="create", stage="reflect", summary="<goal> — <verdict>",
            details="<the reflection block above>")
```

If a rule/skill edit is proposed AND the user approves it, the edit itself goes
into the real file (rules/ or SKILL.md) and is committed — the checkpoint records
that the proposal was made and approved.

## Relationship To Other Skills

- **After:** `forge:loop`'s Closed-Loop Iteration (after ship-ready or budget
  exhaustion), and optionally `forge:merge` (post-ship). The trigger lives in
  Forge.md's Closed-Loop section, NOT inside `forge:verify` — verify only issues
  the pass/fail verdict, it does not itself call reflect.
- **Feeds:** `rules/` and `forge-skills/` — the project's durable knowledge.
- **Not a substitute for:** `forge:feedback` (which handles incoming review
  comments on a PR). Reflect is about the loop's own performance.

If another skill has a stricter rule, follow the stricter rule.
