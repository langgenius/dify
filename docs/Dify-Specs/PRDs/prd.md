---
title: Master PRD — Dify v1.17
status: draft
owner: TBD
updated: 2026-09-20
---

# Master PRD — Dify v1.17

> **Reconstructed from code.** This document is mostly questions, and that is the honest result: a repository records what was built and keeps no record of why it was wanted. The open questions below are the list of things the organisation knows and has never written down — they are the deliverable here, not a gap to be filled in with plausible prose.

## Problem and outcome

OPEN: what problem does Dify solve, for whom, and what outcome does the business expect? `README.md` describes the product to a prospective user; that is positioning, not a requirement, and it is the team's own text rather than something to be restated here [D: README.md].

OPEN: who are the paying customers and what do they buy? The schema carries `provider_orders`, `tenant_credit_pools` and `rate_limit_logs` [D: api/models/provider.py; api/models/model.py], so a commercial model exists; its shape is not recoverable from these tables.

## MVP definition

OPEN: not recoverable. Version `1.17.1` ships across api, web and cli [D: api/pyproject.toml:3], with 13,407 commits since 2023-05-15 [D: git log]. Whatever the MVP was, the tree no longer distinguishes it.

## Personas and top user flows

Actors are recoverable from authentication mechanisms and RBAC, which model permissions rather than people:

| Actor | Reached through | Evidence |
| --- | --- | --- |
| Workspace member | console session + RBAC | `api/controllers/console/wraps.py` |
| Workspace owner / admin | `is_admin_or_owner_required` | `api/controllers/console/workspace/workspace.py` |
| API consumer | service API key | `api/controllers/service_api/wraps.py:428` |
| Web app end user | passport token | `api/controllers/web/wraps.py:166` |
| OAuth client | scoped token | `api/controllers/openapi/workspaces.py:90` |
| Operator | `difyctl` + setup endpoints | `cli/src/commands/tree.generated.ts:1` |
| Enterprise-internal caller | `/inner/api` | `api/controllers/inner_api/` |

OPEN: which of these are distinct personas to the business? The code distinguishes credentials, not people.

OPEN: what are the top user flows by volume? Telemetry is collected [D: api/tasks/enterprise_telemetry_task.py:19]; what it shows is not in this repository.

## Child PRD index

| ID | Feature | Operations | Tables | PRD |
| --- | --- | --- | --- | --- |
| F-001 | App Studio and Publishing | 112 | 26 | `PRDs/prd_v1.17_F-001-app-studio-and-publishing.md` |
| F-002 | Workflow Engine and Authoring | 182 | 33 | `PRDs/prd_v1.17_F-002-workflow-engine-and-authoring.md` |
| F-003 | Knowledge and RAG | 212 | 31 | `PRDs/prd_v1.17_F-003-knowledge-and-rag.md` |
| F-004 | Agent | 99 | 14 | `PRDs/prd_v1.17_F-004-agent.md` |
| F-005 | Workspace, Identity and Access | 232 | 35 | `PRDs/prd_v1.17_F-005-workspace-identity-and-access.md` |
| F-006 | Published App Surfaces | 152 | 4 | `PRDs/prd_v1.17_F-006-published-app-surfaces.md` |
| F-007 | difyctl CLI | 0 | 0 | `PRDs/prd_v1.17_F-007-difyctl-cli.md` |

989 of 1015 operations and all 143 tables are covered. The remaining 26 operations are `/inner/api`, an enterprise-internal surface left undocumented by choice [D: api/controllers/inner_api/].

## Non-functional requirements

Most NFRs are `OPEN:`. The exceptions are the limits the code configures — these are real numbers with real citations, and they are the only non-functional statements this repository makes.

| Concern | Configured default | Key | Source |
| --- | --- | --- | --- |
| Maximum application execution time | 3600 s | `APP_MAX_EXECUTION_TIME` | `api/configs/feature/__init__.py:85` |
| Sandbox code execution — connect | 10.0 s | `CODE_EXECUTION_CONNECT_TIMEOUT` | `api/configs/feature/__init__.py:120` |
| Sandbox code execution — read | 60.0 s | `CODE_EXECUTION_READ_TIMEOUT` | `api/configs/feature/__init__.py:125` |
| Sandbox connection pool | 100 max, 20 keep-alive | `CODE_EXECUTION_POOL_MAX_CONNECTIONS` | `api/configs/feature/__init__.py:135` |
| Sandbox string ceiling | 400000 chars | `CODE_MAX_STRING_LENGTH` | `api/configs/feature/__init__.py:170` |
| Web form submit rate limit | 30 attempts / 60 s | `WEB_FORM_SUBMIT_RATE_LIMIT_MAX_ATTEMPTS` | `api/configs/feature/__init__.py:54` |
| Agent backend stream read timeout | 30 s | `AGENT_BACKEND_STREAM_READ_TIMEOUT_SECONDS` | `api/configs/extra/agent_backend_config.py:30` |
| Agent backend stream reconnects | 3 | `AGENT_BACKEND_STREAM_MAX_RECONNECTS` | `api/configs/extra/agent_backend_config.py:35` |
| Knowledge FS request timeout | 10.0 s | `KNOWLEDGE_FS_TIMEOUT_SECONDS` | `api/configs/extra/knowledge_fs_config.py:23` |
| Enterprise RBAC request timeout | 30 s | `ENTERPRISE_RBAC_REQUEST_TIMEOUT` | `api/configs/enterprise/__init__.py:43` |

134 further numeric limits are declared with defaults in `api/configs/` [D: api/configs/].

These are defaults an operator may override; no value from any `.env` file appears in this hub, by policy.

OPEN: each number above is a setting, not a target. Which were chosen to satisfy a requirement, and what was the requirement? A 3600-second execution ceiling is a fact; the promise it implements is not stated.

OPEN: availability target, p95 latency, supported tenant and request scale, data-retention policy, recovery objectives. None of these appears anywhere in the repository.

OPEN: what compliance regime applies? `SECURITY.md` exists [D: SECURITY.md] and an enterprise telemetry data dictionary is maintained [D: api/enterprise/telemetry/DATA_DICTIONARY.md], but no requirement is stated.

## Traceability

Domain rules in `ddd/`, architecture in `architect/`, contracts in `data/`, as-built tasks in `tasks/`, suites in `tests/`.

OPEN: nothing in the codebase carries a requirement identifier — not a test, not a handler, not a column. Every trace in this hub is therefore inferred from naming and directory structure, and will not survive a rename.

