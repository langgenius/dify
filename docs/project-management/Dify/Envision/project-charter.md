---
title: Project Charter — Dify
status: draft
owner: TBD
updated: 2026-09-20
---

# Project Charter — Dify

> **This document is almost entirely questions, and that is the correct result.** A charter states intent, and intent
> is the one thing a repository does not contain. The questions below are the list of things this organisation knows
> and has never written down; answering them is worth more than anything that could be written here from the code.

## What is recoverable

| Fact | Evidence |
| --- | --- |
| Product version `1.17.1`, released as api, web and cli together | `api/pyproject.toml:3` |
| 13,407 commits from 2023-05-15 to 2026-09-18, 92 contributors | `git log` |
| 1015 HTTP operations, 143 database tables, 24,695 test cases | `api/controllers/`, `api/models/`, `api/tests/` |
| Seven product features, one enterprise-internal surface | `PRDs/prd.md` |
| A commercial dimension exists: orders, credit pools, rate-limit logs, billing guards, enterprise licence checks | `api/models/provider.py`, `api/controllers/console/wraps.py` |
| Deployed as Docker Compose across 14 services | `docker/docker-compose.yaml` |

I: the product is sold in editions — basis: guards named `cloud_edition_billing_resource_check`,
`enterprise_license_required` and `only_edition_self_hosted` branch behaviour by deployment kind — 59, 28 and a
handful of routes respectively [D: api/controllers/console/wraps.py:176; api/controllers/console/wraps.py:324; api/controllers/console/wraps.py:150].

## Purpose

OPEN: why does this product exist, and what would count as it succeeding?

## Objectives and success measures

OPEN: no objective, metric, target or SLO appears anywhere in the repository. Telemetry is collected
[D: api/tasks/enterprise_telemetry_task.py:19]; what it is read for is not stated.

## Scope

OPEN: what is deliberately out of scope for this product? The tree shows what was built and keeps no record of what
was declined.

## Stakeholders

See `stakeholder-analysis.md`. Every entry there is inferred from an authentication mechanism.

## Constraints and assumptions

OPEN: what constrains this project — budget, headcount, a customer commitment, a compliance regime? None is stated.

## Risks

OPEN: what does the team consider the top risks? The index reports an average bus factor of 2.3 with 4,471 files
having a bus factor of 1, which is a measurement rather than the team's own assessment.

## Open questions

- OPEN: who is the product owner, and who decides what ships?
- OPEN: what is the release cadence? The repository carries no tags, so releases leave no mark in it
  [D: `git tag` — empty].
- OPEN: how is the open-source project related to the commercial editions in planning terms?
