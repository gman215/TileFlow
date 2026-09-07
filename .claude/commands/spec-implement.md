---
description: Implement the next unchecked task from a spec, verify it, and tick the box
argument-hint: "[spec-name] (e.g. 001-ai-foundation) — defaults to the first spec with work left"
---

Implement exactly one task from the AI spec suite. One task, verified, then stop.

## Select the task

If `$1` names a spec directory, use it. Otherwise pick the first spec in `.claude/specs/` with
unticked tasks, honouring the dependency order in `ROADMAP.md`: **`001-ai-foundation` must be
complete before any of `002`–`005` starts.**

If the chosen spec depends on 001 and 001 has unticked tasks, say so and switch to 001 instead of
proceeding.

## Get on the right branch first

Before reading anything else, check the branch:

```bash
git rev-parse --abbrev-ref HEAD
```

It must be `feat/<spec-directory-name>` for the spec you are about to work on — `feat/002-photo-to-room`
for `002-photo-to-room`, and so on (Constitution VIII).

- **On the right branch already:** carry on.
- **On `main`:** the spec's **T0** is the task to do. Create the branch (`git switch -c feat/<spec>`),
  tick T0, and continue to T1 in the same run — T0 is a prerequisite, not a whole turn's work.
- **On a different feature's branch:** stop and say so. Switching branches with uncommitted work is
  the user's call, not yours.

Never write a file while on `main`. `main` auto-deploys the live demo.

## Before writing code

Read, in this order:

1. `.claude/specs/CONSTITUTION.md` — the rules this work is held to.
2. The spec's `requirements.md` — specifically the acceptance criteria the task cites.
3. The spec's `design.md` — the exact schemas, file paths and decisions. Do not re-derive what is
   already decided there, and do not substitute your own approach for a documented one.
4. The task text itself, including its `*Verify:*` line.

Note that `001-ai-foundation/design.md` carries a table of **verified** Gemini SDK facts, checked
against live documentation. The SDK's shape differs from older versions of it — use that table, not
recollection. If something there looks wrong, check the live docs and update the table in the same
change rather than working around it.

## Implement

- Exactly the one task. Do not start the next one, do not refactor adjacent code, and do not add
  files the task did not ask for.
- Match the surrounding code: the geometry package and the client both use explanatory comments
  that say *why*, not *what*. Follow that.
- Reuse what exists. The specs name the existing functions to build on — `setRoomShape`,
  `validateShape`, `formatDisplayFromMM`, `summarizeShape` and the rest. Reaching for a new
  implementation of something the repo already has is the most common way these tasks go wrong.
- No new client dependency unless the task explicitly calls for one.

## Verify

Run the task's `*Verify:*` step exactly as written and report what actually happened, including the
output. If it needs a browser check you cannot perform, say so plainly and leave the box unticked —
an honestly unticked box is useful; a wrongly ticked one costs someone an afternoon.

Also run, when the task touched code they cover:

- `npm run typecheck:api`
- `cd client && npx tsc --noEmit`
- `npm test --workspace @tileflow/geometry`

## Finish

- Tick the box in `tasks.md` **only** if verification actually passed.
- Report: what changed (with file paths), what verification showed, the branch you are on, and the
  next unticked task.
- Do not commit, merge or push unless asked. Creating and switching to the branch is part of the
  workflow; publishing it is the author's decision.
