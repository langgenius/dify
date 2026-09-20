---
title: Product Backlog — Dify v1.17
status: draft
owner: TBD
updated: 2026-09-20
---

# Product Backlog — Dify v1.17

> **Reconstructed and inverted.** A backlog lists work not yet done; this lists work already shipped, sized by the
> surface it occupies. It is useful as a map of the product, not as a plan. Value and priority are `OPEN:` because a
> repository records neither.

| ID | Feature | Operations | Owned tables | Shipped tasks | Value | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| F-001 | App Studio and Publishing | 112 | 26 | 50 | OPEN | OPEN |
| F-002 | Workflow Engine and Authoring | 182 | 33 | 59 | OPEN | OPEN |
| F-003 | Knowledge and RAG | 212 | 31 | 56 | OPEN | OPEN |
| F-004 | Agent | 99 | 14 | 27 | OPEN | OPEN |
| F-005 | Workspace, Identity and Access | 232 | 35 | 58 | OPEN | OPEN |
| F-006 | Published App Surfaces | 152 | 4 | 54 | OPEN | OPEN |
| F-007 | difyctl CLI | — | — | 28 | OPEN | OPEN |

Sizes are surface counts [D: api/controllers/; api/models/], not estimates of effort.

## Not in this backlog

- **`/inner/api` — 26 operations.** An enterprise-internal surface, excluded by choice [D: api/controllers/inner_api/].
- **Operational endpoints** — `/health`, `/threads`, `/db-pool-stat` [D: api/extensions/ext_app_metrics.py:20],
  `/console/api/ping`, `/console/api/version`. These belong in a runbook.
- **581 smaller clusters** the clustering pass set aside. Documenting them is a second run, not a bigger one.
- **`web/` (652 code files) and `packages/` (360)** — covered at architecture level only, per the agreed scope.

## Open questions

- OPEN: what is the ordering principle behind this product's roadmap? The largest surfaces are workspace
  administration and knowledge, which may reflect priority or merely age.
- OPEN: which of these features are actively invested in? Churn ranks files, not intent, and published precision for
  history-derived prediction is around 29% — it should not be read as a priority signal.
