---
title: Product Roadmap — Dify
status: draft
owner: TBD
updated: 2026-09-20
---

# Product Roadmap — Dify

> **Not recoverable.** A roadmap is a statement about the future, and a working tree contains only the present.
> Nothing below should be read as a plan.

## What the tree shows about direction

These are observations, not roadmap items, and each is `I:` with its basis stated.

- I: Agent is the newest major surface and is under active construction — basis: it ships nine dedicated tables, a
  separate Python service and a separate Go runtime, and `git log --since=2026-06-01` shows 50 commits touching
  `api/controllers/console/agent/roster.py` alone [D: api/models/agent.py; dify-agent/; dify-agent-runtime/].
  This last figure is a history query and ranks attention only — it proves nothing about intent, and published
  precision for history-derived prediction is around 29%.
- I: a per-use-case service extraction is in progress across the backend — basis: 30 `forbidden` import contracts
  pin narrow services to single controllers, all added without exceptions [D: api/.importlinter].
- I: a migration away from stacked auth decorators toward `console_account_admission` is underway and incomplete — basis: 111 routes use the newer combined decorator while 601 still carry `setup_required` [D: api/controllers/console/flask_admission.py:55].
- I: the 93 grandfathered import-layer exceptions are intended to be drained — basis: the configuration says the list
  should shrink and makes a stale entry an error [D: api/.importlinter:26].

None of these is a commitment. Each is a shape visible in the code with no stated destination.

## Open questions

- OPEN: what is actually planned for the next release? Not in this repository.
- OPEN: is any of the above an intended programme of work, or incidental?
- OPEN: what is the release cadence and what defines a minor version? No tags exist to infer from.
