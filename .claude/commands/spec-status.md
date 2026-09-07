---
description: Report progress across all AI specs — what's done, what's next, what's blocked
---

Report the current state of the spec suite in `.claude/specs/`. Read-only: do not edit anything.

1. Read `.claude/specs/ROADMAP.md` for the feature list and declared status.
2. For each spec directory (`001-*` through `005-*`), read its `tasks.md` and count ticked
   (`- [x]`) versus unticked (`- [ ]`) boxes.
3. Run `git rev-parse --abbrev-ref HEAD` and `git branch --list 'feat/*'` to see which spec
   branches exist and which one is checked out.
4. Report as a compact table: spec, branch (exists? checked out?), ticked/total, and the title of
   the next unticked task.
5. Call out these specific conditions:
   - **Work in progress on `main`.** If `git status` is dirty while on `main`, say so first — that
     work belongs on a feature branch (Constitution VIII), and `main` auto-deploys the live demo.
   - A spec with ticked tasks but no `feat/<spec>` branch anywhere — the work went somewhere it
     shouldn't have.
   - Any feature spec with progress while `001-ai-foundation` is incomplete — 001 blocks all of
     them, and building on unfinished plumbing is how the four features end up with four different
     error-handling styles.
   - Any spec whose tasks are all ticked but whose ROADMAP status still says "Not started" — the
     status column needs updating.
   - Any spec whose final verification task is ticked but where `git log` shows no commit touching
     the files that task names — a box ticked without the work behind it.
6. Finish with the single next action: the next unticked task, by spec and task number, and the
   branch it should be done on.

Keep it short. This is a status check, not a review.
