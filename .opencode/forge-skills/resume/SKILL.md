---
name: forge:resume
hidden: true
description: Use when a user asks to continue, resume, pick up prior loop work, or inspect previous loop state
---

# Resuming A Prior Loop

## Overview

A loop's state lives in `forge-check` checkpoints, not chat memory. When a new
session needs to continue work a previous session started, reconstruct the state
from the checkpoint and resume from where it stopped.

**Core principle:** Resume is evidence-driven — you rebuild state from the written
checkpoint, never from your recollection of what the prior session "probably" did.

## When To Use

Run `forge:resume` when the user says anything like:

- "continue", "resume", "pick up where we left off"
- "keep going on the loop / the feature / the fix"
- "what were we doing last time?"

If the user gives a brand-new task with no resume signal, do NOT run resume —
start a fresh loop instead. Resume is opt-in, never automatic on every session.

## The Resume Sequence

1. **Find the latest checkpoint:**
   ```
   forge-check(operation="latest")
   ```
   Read the returned file. The meaningful content is the JSON object in the
   `details` body (per `forge:loop` Memory Checkpoints schema).

2. **Parse the schema.** Extract and restate to the user:
   - `goal` — what the loop is delivering
   - `rubric` — each criterion and its current `status` (pending/pass/fail/blocked)
   - `discovery` — files, impact surface, risk already mapped
   - `budget` — `max_fix_iterations`, `used_fix_iterations`, `remaining`
   - `current_task` and `next_action` — where it stopped
   - `blockers` and `residual_risks`

3. **Reconstruct and confirm.** Present the rebuilt state in 5-8 lines and ask
   via `forge:ask` whether to continue from `next_action`. If no user is
   available, continue from `next_action` directly (autonomous override).

4. **Resume the loop.** Hand the rebuilt state into `forge:loop` as a
   "spec/plan already exists" case (per loop's Pre-Loop Routing): Goal and Rubric
   come from the checkpoint, Budget resumes with the current `used` count, and
   the next step is `next_action`. Do NOT re-run discovery or re-plan unless the
   checkpoint's discovery is stale (files changed) or `next_action` says to.

5. **Handle missing or malformed checkpoints.** If `latest` returns nothing, say
   so and start fresh. If the JSON is missing fields the loop needs (goal, rubric,
   next_action), state exactly which fields are missing before proceeding — do
   not invent them. Treat missing `next_action` as "blocked: resume context
   incomplete" and ask the user.

## What Resume Does NOT Do

- It does not re-litigate design — brainstorm decisions in the checkpoint stand.
- It does not reset the budget — `used` carries over, so a loop near exhaustion
  stays near exhaustion.
- It does not skip verify — the resumed step still hits `forge:verify` per the loop.

## Relationship To Other Skills

- **Reads:** `forge-check` checkpoints (written by `forge:loop`).
- **Hands off to:** `forge:loop` (as a "spec already exists" resume case).
- **Sister to:** `forge:reflect` (which writes a retrospective after a loop ends;
  resume reads the running state, reflect reads the closing one).

If another skill has a stricter rule, follow the stricter rule.
