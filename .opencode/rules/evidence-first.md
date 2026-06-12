---
name: evidence-first
description: Evidence-based methodology for non-obvious problems. Defines 4-level evidence scale, 5-step procedure, and anti-guess checklist to prevent LLM guesswork.
---

# Evidence-First Methodology

**RULE TYPE**: Mandatory methodology for non-obvious problems.

## Why This Rule Exists

LLMs do not bind "confident tone" to "factual correctness". Models naturally slide into deterministic expression while internal state may be pure guesswork. This rule addresses three symptoms:

1. Conclusions lacking an evidence chain are packaged with confident tone.
2. Reasoning skips "falsifiability" checks.
3. `coding-standards` Anti-Rationalization discipline only covers "testing/completion" stages, leaving daily reasoning with a gap.

## Four Evidence Levels

Every non-obvious conclusion MUST self-assess its evidence level:

| Level | Definition                                          | Expression Convention                              |
| ----- | --------------------------------------------------- | -------------------------------------------------- |
| L1    | Direct evidence: obtained by execution/read/repro   | "I ran command X, result is Y"                     |
| L2    | Indirect evidence: logs / types / call chains       | "Inferred from call chain A→B→C"                   |
| L3    | Inference: based on known patterns / common practice| "Typically X causes Y (to be verified)"           |
| L4    | Guess: lacking direct basis                         | **MUST be explicitly tagged**: "This is a guess, low confidence" |

**Iron rule**: L3 / L4 MUST NOT be expressed with deterministic tone. L4 MUST provide a verification step.

## 5-Step Evidence Procedure (When Facing Non-Obvious Problems)

1. **Reproduce**: Reduce the problem to a triggerable minimal scenario.
   - Bad: "Probably an X config issue."
   - Good: Provide an executable reproduction command or code snippet.

2. **Isolate**: Reduce variables to a minimum.
   - Exclude irrelevant factors; use binary search to narrow scope.

3. **Hypothesize**: MUST be falsifiable.
   - Bad: "Code logic is wrong."
   - Good: "If hypothesis A holds, then B must be true; verifying B falsifies A."

4. **Verify**: MUST execute, not just read.
   - "Looks correct" is not evidence.
   - Run commands, inspect output, check exit codes, measure metrics.

5. **Conclude**: Tag evidence level + residual risk.
   - State confidence (high / medium / low).
   - List unexcluded alternative hypotheses.

## Explicit Expression of Uncertainty

**Mandatory** when L1 / L2 cannot be reached:

- Use explicit markers: "I infer", "possibly", "by L3 reasoning", "to be verified".
- Provide a "fastest verification path": 1-2 falsifiable commands.
- Proactively offer "most likely counter-example": where this conclusion could be wrong.

**Forbidden**:

- Wrapping L3 / L4 conclusions with "should", "obviously", "definitely".
- Chaining multiple L3s to upgrade to L1 tone (inference of inference = greater uncertainty).
- Skipping "falsification" and jumping directly to a solution.

## Anti-Guess Checklist (Before Giving Any Non-Obvious Conclusion)

Extended from `coding-standards` Anti-Rationalization Pattern, covering non-bug scenarios:

- [ ] Did I actually execute/read, instead of relying on "looks like"?
- [ ] What evidence level is this conclusion (L1-L4)?
- [ ] Did I actively think about "what would make this conclusion wrong"?
- [ ] If L3 / L4, did I provide verification steps?
- [ ] Did I re-read all relevant files/calls (not relying on memory)?
- [ ] Did I measure rather than estimate (performance / quantity / time)?
- [ ] Am I using "user probably wants X" to replace "user said X"?

## Relationship with Other Rules

- **`coding-standards` Anti-Rationalization**: Covers "testing/completion" anti-rationalization; this rule covers "daily reasoning" across all scenarios.
- **`character.md` Delivery Closure**: character.md's "交付闭环 (Delivery Closure)" section references this rule for verification methodology.
- **debug / verify type skills**: This rule is the methodological backbone for related skills (specific skill names vary by agent).
- **Conflict priority**: When this rule conflicts with "fast delivery", **the evidence procedure is non-negotiable**; only the expression form may be compressed.

## Scope of Application

- **Applies**: Performance bottleneck localization, architecture selection, dependency conflicts, concurrency issues, third-party library behavior inference, vaguely described bugs, cross-file changes.
- **Weakly applies**: Pure CRUD, boilerplate code with clear patterns (can reuse rules directly, no per-step evidence needed).
- **Does not apply**: Greetings, chit-chat, unambiguous simple rewrites.
