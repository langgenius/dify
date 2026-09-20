---
title: Resource and Cost — Dify
status: draft
owner: TBD
updated: 2026-09-20
---

# Resource and Cost — Dify

> **Not recoverable from code.** People, budget and time are not in a repository. What follows is the measurable
> shape of the work, which is not the same thing and must not be read as an estimate.

## Measurable size

| Measure | Value | Evidence |
| --- | --- | --- |
| Code files | 12,767 | repository index |
| Lines of code | ~2.04 M | repository index |
| Commits | 13,407 since 2023-05-15 | `git log` |
| Contributors | 92 | `git log` |
| HTTP operations | 1,015 | `api/controllers/` |
| Database tables | 143 | `api/models/` |
| Test cases | 24,695 across 2,182 files | `api/tests/`, `web/`, `cli/test/` |
| CI workflows | 37 | `.github/workflows/` |
| Provider packages to maintain | 51 (43 vector, 8 tracing) | `api/providers/` |

## Runtime cost drivers visible in code

- 14 Compose services must run for a full deployment, including two database engines
  [D: docker/docker-compose.yaml:425; docker/docker-compose.yaml:462].
- Model inference is delegated to external providers per tenant credential [D: api/models/provider.py].
- `tenant_credit_pools` and `provider_orders` exist, so consumption is metered [D: api/models/model.py:2694].

OPEN: what does an installation cost to run, and what drives that cost most? The schema meters credits; nothing
states the unit economics.

## Open questions

- OPEN: team size and composition. Not recoverable; 92 commit authors is not a team.
- OPEN: budget, time horizon, opportunity cost. None stated.
- OPEN: what is the maintenance cost of 51 provider packages, and is it accounted for anywhere?
