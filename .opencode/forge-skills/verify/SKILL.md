---
name: forge:verify
hidden: true
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
---

# Verification Before Completion

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

**Loop principle:** Verification is the loop gate, not a test shortcut. Passing tests
alone is not completion unless every acceptance criterion is also proven or explicitly
out of scope.

**Violating the letter of this rule is violating the spirit of this rule.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

## Acceptance Gate

Before running commands, derive or re-read the task's acceptance criteria. Treat these
criteria as the rubric that decides whether the loop ships, iterates, or escalates.

Use this order:

1. **Rubric:** List every requirement, constraint, and explicit non-goal that defines
   completion. Include user-stated acceptance criteria, plan/spec `Covers:` sections,
   regression symptoms, and relevant risk gates.
2. **Evidence:** For each rubric item, attach the strongest available proof: command
   output, test name, build result, diff evidence, reviewer verdict, or `file:line`.
3. **Verdict:** Mark each item as `pass`, `fail`, `unverifiable`, or `out-of-scope`.
   `unverifiable` is not a soft pass.
4. **Loop action:**
   - all in-scope items pass → ship/report/merge may proceed
   - any `fail` → write the next iteration prompt and continue fixing
   - any `unverifiable` → gather evidence, ask via `forge:ask`, or block with reason
   - budget or environment prevents verification → state the limit and highest-risk gap

## Required Output

Every verification must end with this compact structure:

```markdown
Verification verdict: pass | fail | blocked
Evidence: <command/reviewer/file evidence, max 2 lines for user-facing summary>
Rubric gaps: <none | failed/unverifiable items>
Next loop action: ship | iterate with <prompt> | ask/block because <reason>
```

The user-facing final answer may be shorter, but your decision must be based on this
rubric. Do not collapse `Rubric gaps` into "tests pass".

## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Agent completed | VCS diff shows changes | Agent reports "success" |
| Requirements met | Line-by-line checklist | Tests passing |
| Loop can ship | Rubric verdict: all in-scope pass | Test/lint/build only |

## Red Flags - STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!", etc.)
- About to commit/push/PR without verification
- Trusting agent success reports
- Relying on partial verification
- Thinking "just this once"
- Tired and wanting work over
- **ANY wording implying success without having run verification**

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler |
| "Agent said success" | Verify independently |
| "I'm tired" | Exhaustion ≠ excuse |
| "Partial check is enough" | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter |

## Key Patterns

**Tests:**
```
✅ [Run test command] [See: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**Regression tests (TDD Red-Green):**
```
✅ Write → Run (pass) → Revert fix → Run (MUST FAIL) → Restore → Run (pass)
❌ "I've written a regression test" (without red-green verification)
```

**Build:**
```
✅ [Run build] [See: exit 0] "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

**Requirements:**
```
✅ Re-read plan → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, phase complete"
```

**Loop gate:**
```
✅ Rubric pass + evidence → Ship
✅ Rubric fail → Write next prompt and iterate
❌ Tests pass → Ship while spec/review gaps remain
```

**Agent delegation:**
```
✅ Agent reports success → Check VCS diff → Verify changes → Report actual state
❌ Trust agent report
```

## Why This Matters

From 24 failure memories:
- your human partner said "I don't believe you" - trust broken
- Undefined functions shipped - would crash
- Missing requirements shipped - incomplete features
- Time wasted on false completion → redirect → rework
- Violates: "Honesty is a core value. If you lie, you'll be replaced."

## When To Apply

**ALWAYS before:**
- ANY variation of success/completion claims
- ANY expression of satisfaction
- ANY positive statement about work state
- Committing, PR creation, task completion
- Moving to next task
- Delegating to agents

**Rule applies to:**
- Exact phrases
- Paraphrases and synonyms
- Implications of success
- ANY communication suggesting completion/correctness

## The Bottom Line

**No shortcuts for verification.**

Run the command. Read the output. THEN claim the result.

This is non-negotiable.
