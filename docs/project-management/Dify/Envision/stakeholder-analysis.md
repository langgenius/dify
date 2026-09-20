---
title: Stakeholder Analysis — Dify
status: draft
owner: TBD
updated: 2026-09-20
---

# Stakeholder Analysis — Dify

> Reconstructed from authentication mechanisms and permission checks. The code models credentials, not people, so
> every row below is an inference about who holds a credential, never a statement about a role in the business.

| Stakeholder | Inferred from | Evidence |
| --- | --- | --- |
| Workspace member | console session + RBAC permission checks | `api/controllers/console/wraps.py` |
| Workspace owner / admin | `is_admin_or_owner_required` on 56 routes | `api/controllers/console/workspace/` |
| Tenant (the billed unit) | 87 of 143 tables carry `tenant_id` | `api/models/` |
| API consumer | service API key on `/v1` | `api/controllers/service_api/wraps.py:428` |
| Published app end user | passport token on `/api` | `api/controllers/web/wraps.py:166` |
| OAuth integrator | scoped token on `/openapi/v1` | `api/controllers/openapi/workspaces.py:90` |
| Operator / self-hoster | Compose stack, setup endpoints, `difyctl` | `docker/docker-compose.yaml`, `api/controllers/console/setup.py` |
| Enterprise deployment | `enterprise_license_required`, `/inner/api`, enterprise telemetry | `api/enterprise/` |
| Plugin and provider authors | plugin daemon, 51 provider packages | `api/providers/`, `docker/docker-compose.yaml:573` |
| Contributors | 92 authors, contribution guide, agent instructions | `CONTRIBUTING.md`, `AGENTS.md` |

## Open questions

- OPEN: which of these are customers, which are users, and which are neither? A credential does not say who pays.
- OPEN: who are the largest deployments and what do they need? Not recoverable.
- OPEN: what is the relationship between the community edition and the enterprise edition in terms of who is
  accountable for each?
