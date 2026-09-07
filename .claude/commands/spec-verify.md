---
description: Run a spec's verification block and report — no edits, no fixes
argument-hint: "<spec-name> (e.g. 002-photo-to-room)"
---

Run the verification block at the bottom of `.claude/specs/$1/tasks.md` and report the results.

**Read-only with one exception:** you may tick a task box whose verification you just ran and
observed passing. Do not fix failures, do not refactor, do not implement anything. Reporting a
failure accurately is the job here — fixing it is `/spec-implement`'s.

## Procedure

1. Read the spec's `tasks.md` verification block and its `requirements.md` for the acceptance
   criteria each check cites.
2. Read `.claude/specs/CONSTITUTION.md` — the review gate at the end applies to every spec.
3. Work through the numbered checks in order. For each, report **PASS**, **FAIL** or **CANNOT
   VERIFY** (with the reason — a missing key, a check needing a browser or a real photo).
4. Run the constitution's review gate in addition to the spec's own checks:
   - the work is on `feat/$1`, not on `main` (Constitution VIII) —
     `git rev-parse --abbrev-ref HEAD`,
   - the spec's tasks are all ticked,
   - it behaves correctly with `GEMINI_API_KEY` unset,
   - `npm run typecheck:api` and `npm test --workspace @tileflow/geometry` are clean,
   - `git grep --untracked -iE "AIza" -- . ':!*.lock' ':!.claude/'` returns nothing,
   - `git status --porcelain | grep -E '\.env(\.|$)'` returns nothing.

## Report

A table of check → result → evidence, then a one-line verdict: **spec verified** or **N checks
failing**. List failures with enough detail to act on — the command run, the expected result and
what actually happened.

Do not soften a failure into a caveat. If a number in a generated brief does not match
`StatsPanel`, that is a FAIL of the grounding rule, not a rounding note.
