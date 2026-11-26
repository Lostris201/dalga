---
description: Run the Dalga milestone loop. Plan if needed, implement task by task with review, then finish the branch.
argument-hint: "[milestone number, default: the next one on the ship board]"
---

Milestone: $ARGUMENTS (if empty, take the next unticked milestone in CLAUDE.md's ship board).

1. Read CLAUDE.md, `docs/superpowers/NEXT_SESSION.md` and the spec. If the M1 device check is still
   unticked, stop: tell Cihan exactly what to run and look for, and wait for his result.
2. If an open decision in CLAUDE.md blocks this milestone, ask Cihan that one question first.
3. No plan for this milestone in `docs/superpowers/plans/`? Use `superpowers:writing-plans` against the
   spec's milestone list, then show Cihan the task list before implementing.
4. Use `superpowers:subagent-driven-development`: a fresh `dalga-engineer` per task, `dalga-reviewer` after
   each. CHANGES goes back to the engineer once; a second CHANGES stops and reports.
5. Whole-branch `dalga-reviewer` pass, then `superpowers:finishing-a-development-branch` (merge only if Cihan says so).
6. Update the ship board in CLAUDE.md and rewrite `docs/superpowers/NEXT_SESSION.md` for the next session.
7. Report: what's done, what needs a phone test (exact steps), what's blocked, the next box.
