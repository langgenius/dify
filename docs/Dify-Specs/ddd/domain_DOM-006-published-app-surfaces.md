---
title: Domain — Published App Surfaces
id: DOM-006
feature: F-006
kind: domain
status: draft
owner: TBD
updated: 2026-09-20
---

# Domain — Published App Surfaces (DOM-006)

> Reconstructed from the code. Terms are the identifiers the code uses; rules are promoted from comments that state a rule, and each names the code that enforces it.

## Ubiquitous language

The enumerations the schema constrains are the domain's own vocabulary — every value below is a string the database will accept and no other.

| Term | Permitted values | Source |
| --- | --- | --- |
| `end_users.type` | app-deploy, browser, mcp, openapi, service-api, trigger | `api/models/model.py:2089` |
| `pinned_conversations.created_by_role` | account, end_user | `api/models/web.py:42` |
| `saved_messages.created_by_role` | account, end_user | `api/models/web.py:14` |

OPEN: several enum values carry no visible meaning beyond their spelling. What distinguishes them to a user?

## Actors

| Actor | Does | Evidence |
| --- | --- | --- |
| API consumer | calls `/v1` with a workspace API key | `api/controllers/service_api/wraps.py:428` |
| Web app visitor | uses a published app through a passport token | `api/controllers/web/wraps.py:166` |
| OAuth client | calls `/openapi/v1` with a scoped token | `api/controllers/openapi/workspaces.py:90` |

OPEN: which of these are distinct personas to the business, and which are the same person in two modes? The code models permissions, not people.

## Business rules

Promoted from 2 rule-bearing comments in this feature's files. Each is `I:` — a comment is evidence that someone knew the rule, not proof the code still enforces it.

**DOM-006-R1** — I: `get_datasets_by_ids` resolves the ids it was handed in a single page (`per_page=len(ids)`), so `limit` never bounded this result and there is never a next page to ask for. — basis: stated in a comment at the enforcement site [D: api/controllers/console/explore/trial.py:918]

**DOM-006-R2** — I: Create a workflow app in the account's owner tenant. Workflow mode is used because its template seeds no ``model_config``, so ``AppService.create_app`` never reaches ``ModelManager`` — keeping the fixture free of model-runtime patching. — basis: stated in a comment at the enforcement site [D: api/tests/test_containers_integration_tests/controllers/openapi/test_apps.py:25]

OPEN: every rule above states *what*; none states *why*. Which are regulatory, which are product decisions, and which are workarounds?

## Process flow

Recoverable only as call sequence, not as a business process. See `architect/feature_v1.17_F-006_architect.md` and the endpoint table in `data/api-contract_v1.17_F-006.md`.

OPEN: what is the intended happy path from a user's point of view? A route table gives the operations, never the order a person performs them in.

## Invariants

Enforced by the database for this feature: 26 not-null columns and 1 cross-column uniqueness constraints [D: api/models/].

- `installed_apps` is unique on (`tenant_id`, `app_id`) [D: api/models/model.py:974]

I: referential invariants between these tables are enforced in service code, not by the database — basis: only 8 `ForeignKey()` declarations exist across all 143 tables [D: api/models/].

OPEN: which invariants does the business require that nothing in the code checks? Those are the ones a bad migration or a direct database write would break silently.

## Implementation status

One row per rule above. States and what `done` costs: `status-model.md`.

| Rule | Status | Evidence |
| --- | --- | --- |
| DOM-006-R1 | todo | — |
| DOM-006-R2 | todo | — |

## Open questions

- OPEN: is this feature boundary the one the team recognises? It was drawn from handler directories and table ownership, not from anyone's statement of the domain.
- OPEN: no rule in this document is named by any test. Which of them are actually verified, and which only exist as prose next to the code?
- OPEN: what is the source of truth when a comment and the code beside it disagree?
