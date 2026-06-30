---
name: forge:plan
hidden: true
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the forge:plan skill to create the implementation plan."

**Context:** If working in an isolated worktree, it should have been created via the `forge:worktree` skill at execution time.

**Save plans to:** `docs/forge/plans/YYYY-MM-DD-<feature-name>.md`
- (User preferences for plan location override this default)

## Scope Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs during brainstorming. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use forge:subagent (recommended) or forge:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

**Platform Preset:** [Framework + version + known constraints, or "none"]

---
```

## Platform Preset

If the project uses a framework, runtime, build tool, or deployment target with known
quirks, the plan must name it before task decomposition.

Capture:
- Framework/tool + version, from package files, lockfiles, config, or command output.
- Entry-point, bundling, permission, routing, schema, or deployment constraints.
- A short checklist of platform-specific pitfalls that tasks must respect.
- One verification command that proves the platform integration still works.

If you cannot identify the platform/version, say so and route back to `forge:discovery`
instead of inventing constraints.

## Task Structure

````markdown
### Task N ([complexity]): [Component Name]

**Complexity:** trivial | standard | complex

**Covers:** [S3, S7]
<!-- spec section anchors this task implements; every task that produces
     spec-required behavior must list at least one. Omit only for pure
     scaffolding tasks (e.g. project setup) that map to no spec section. -->

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

Complexity routing:

| Complexity | Use for | Execution path |
|------------|---------|----------------|
| `trivial` | Type-only files, utilities, re-export barrels, docs/config wording | Controller may edit directly, then run targeted verification |
| `standard` | Single-module behavior with tests or localized integration | Use implementer + spec review |
| `complex` | Cross-module contracts, state machines, security, data, perf, UI flows | Use implementer + spec review + code quality review |

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

## Remember
- Exact file paths always
- Complete code in every step — if a step changes code, show the code
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each `[Sn]` section in the spec. Can you point to a task whose **Covers:** lists it? Every spec section must be covered by at least one task. Conversely, every `Covers:` ID must resolve to a real spec section. List any gap in either direction and add or fix the task.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

**4. Plan lint pass:** Treat literal snippets as draft code, not prose. For every fenced
code/config/command block, check whether it is plausibly runnable in its planned
location:
- Resolve relative import paths against the file path listed in `Files:`.
- Validate JSON/YAML/TOML syntax when the block is complete config.
- Run `git-conventions` on any commit message shown in the plan.
- For TypeScript/JavaScript snippets, include the exact project command that will catch
  type or build failures later, even if you cannot execute the snippet standalone.
- For platform presets, include the platform verification command from that preset.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.

## Plan Lint Pass

For non-trivial plans or any plan with literal code/config/commit-message blocks,
dispatch a reviewer subagent before execution. The reviewer treats the plan as a
draft artifact, not source of truth.

Ask it to return:
- Fenced code/config blocks that are syntactically invalid or missing required fields.
- Relative imports that do not resolve from the planned file location.
- Commit messages that fail `git-conventions`.
- Platform-preset verification gaps.
- Any task whose `Complexity:` tag is too low for its risk surface.

Fix the plan before dispatching implementers. Skip this pass only for trivial plans
with no literal snippets and state the reason.

## Execution Handoff

After saving the plan, determine execution approach:

1. **No persistent preference** — this setup doesn't have cross-session memory, so we always ask fresh.

2. **Ask through `forge:ask`:**
   - header: `Execution`
   - question: `Plan saved. How would you like to execute it?`
   - options:
     - label: `Subagent`, description: `Fresh subagent per task + two-stage review (recommended for > 3 independent tasks)`
     - label: `Inline`, description: `Execute in this session with checkpoints (recommended for ≤ 3 tightly coupled tasks)`

   If no user is available, default to **Subagent** for any non-trivial plan (it's the safer and higher-quality default — also exercises the forge orchestrator end-to-end).

**If Subagent:** Use `forge:subagent` — fresh subagent per task + two-stage review. Each task gets a TID via `punchcard` and is bound to the implementer subagent via the upstream `task` tool.

**If Inline:** Use `forge:execute` — batch execution with checkpoints in the orchestrator's own context.

## Living Plan Document (SDD Trace)

A plan is not frozen once written. It is a **living document** that executors write
back to as work proceeds, so any session can reconstruct what was done, when, and
why — without relying on chat memory or home-directory state.

### Required sections executors append to the plan file

**1. `## Execution Progress`** — appended once per task completion.

```markdown
## Execution Progress

- [x] Task 1 (commit: abc1234) — verify pass — 2026-06-30T14:21
- [x] Task 2 (commit: def5678) — verify pass — 2026-06-30T14:45
- [ ] Task 3 — in_progress
- [ ] Task 4 — pending
```

Rules:
- Flip the task's `- [ ]` checkbox to `- [x]` when the task passes `forge:verify`.
- Leave it `- [ ]` with an `in_progress` / `blocked` / `pending` annotation otherwise.
- Each completed line MUST include: commit SHA (or "no commit yet"), verify verdict, ISO-8601 timestamp.

**2. `## Loop Trace`** — appended once per loop stage transition (only when the plan
runs under `forge:loop`).

```markdown
## Loop Trace

- 2026-06-30T14:20 — loop-start — budget: 3/3 — rubric: 5 items
- 2026-06-30T14:45 — iteration-1 — Task 2 verify fail (missing progress reporting) — strategy: add PROGRESS_INTERVAL constant
- 2026-06-30T15:02 — ship-ready — all rubric items pass — residual: none
```

Rules:
- One line per stage: `loop-start`, `iteration-N`, `verify-failed`, `ship-ready`.
- `iteration-N` lines MUST include the failure reason and the strategy change.
- `ship-ready` lines MUST include residual risks.

### Why this matters

- **Auditability:** owners can see the execution trajectory inside the project, not in home-dir JSON.
- **Cross-session resume:** `forge:resume` reads this section first; only falls back to `forge-check` if it is missing.
- **Reflect fodder:** `forge:reflect` uses the Loop Trace to spot repeated failure patterns.
- **Git log complement:** git records commits; the plan records *why* a commit was needed and *whether* it passed verify.

### Executor contract

Both `forge:execute` and `forge:subagent` MUST write back to these sections after
each task and each loop stage transition. Skipping the writeback is a false
completion — the work is not "done" until the plan document reflects it.

If the plan file is read-only or missing, stop and report rather than silently
proceeding without trace.
