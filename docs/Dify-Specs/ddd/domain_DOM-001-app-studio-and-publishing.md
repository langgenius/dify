---
title: Domain — App Studio and Publishing
id: DOM-001
feature: F-001
kind: domain
status: draft
owner: TBD
updated: 2026-09-20
---

# Domain — App Studio and Publishing (DOM-001)

> Reconstructed from the code. Terms are the identifiers the code uses; rules are promoted from comments that state a rule, and each names the code that enforces it.

## Ubiquitous language

The enumerations the schema constrains are the domain's own vocabulary — every value below is a string the database will accept and no other.

| Term | Permitted values | Source |
| --- | --- | --- |
| `app_mcp_servers.status` | normal, active, inactive | `api/models/model.py:2122` |
| `app_model_configs.prompt_type` | simple, advanced | `api/models/model.py:717` |
| `apps.mode` | completion, workflow, chat, advanced-chat, agent-chat, agent, channel, rag-pipeline | `api/models/model.py:407` |
| `apps.status` | normal | `api/models/model.py:407` |
| `conversations.mode` | completion, workflow, chat, advanced-chat, agent-chat, agent, channel, rag-pipeline | `api/models/model.py:1109` |
| `conversations.status` | normal | `api/models/model.py:1109` |
| `conversations.invoke_from` | service-api, web-app, trigger, explore, debugger, published, validation, openapi | `api/models/model.py:1109` |
| `conversations.from_source` | api, console | `api/models/model.py:1109` |
| `exporle_banners.status` | enabled, disabled | `api/models/model.py:1051` |
| `message_agent_thoughts.created_by_role` | account, end_user | `api/models/model.py:2454` |
| `message_chains.type` | system | `api/models/model.py:2435` |
| `message_feedbacks.rating` | like, dislike | `api/models/model.py:1836` |
| `message_feedbacks.from_source` | user, admin | `api/models/model.py:1836` |
| `message_files.created_by_role` | account, end_user | `api/models/model.py:1886` |
| `message_files.belongs_to` | user, assistant | `api/models/model.py:1886` |
| `messages.status` | normal, paused, error | `api/models/model.py:1442` |
| `messages.invoke_from` | service-api, web-app, trigger, explore, debugger, published, validation, openapi | `api/models/model.py:1442` |
| `messages.from_source` | api, console | `api/models/model.py:1442` |
| `messages.app_mode` | completion, workflow, chat, advanced-chat, agent-chat, agent, channel, rag-pipeline | `api/models/model.py:1442` |
| `sites.customize_token_strategy` | must, allow, not_allow, uuid | `api/models/model.py:2169` |
| `sites.status` | normal | `api/models/model.py:2169` |
| `tags.type` | knowledge, app, snippet, skill | `api/models/model.py:2607` |
| `tenant_credit_pools.pool_type` | paid, free, trial | `api/models/model.py:2694` |
| `upload_files.created_by_role` | account, end_user | `api/models/model.py:2324` |

OPEN: several enum values carry no visible meaning beyond their spelling. What distinguishes them to a user?

## Actors

| Actor | Does | Evidence |
| --- | --- | --- |
| Workspace member | creates, edits and publishes apps through the console | `api/controllers/console/app/app.py:638` |
| End user | uses a published app | `api/models/model.py — `end_users`` |

OPEN: which of these are distinct personas to the business, and which are the same person in two modes? The code models permissions, not people.

## Business rules

Promoted from 47 rule-bearing comments in this feature's files. Each is `I:` — a comment is evidence that someone knew the rule, not proof the code still enforces it.

**DOM-001-R1** — I: Log a warning message to inform the user that the database schema cannot be inspected in offline mode, and the generated SQL may not accurately reflect the actual execution. — basis: stated in a comment at the enforcement site [D: api/migrations/versions/2024_10_10_0516-bbadea11becb_add_name_and_size_to_tool_files.py:28]

**DOM-001-R2** — I: Recorded by the enterprise caller's own audit log; it never enters the grant because a rotated key must not strand the files it uploaded. — basis: stated in a comment at the enforcement site [D: api/controllers/inner_api/app/file_grants.py:78]

**DOM-001-R3** — I: One requested file reference, either resolved or accounted for. The resolve endpoint and optional mint references answer item by item so one missing history file cannot fail a whole run. A file that exists but belongs to another owner is reported exactly like one that never existed. — basis: stated in a comment at the enforcement site [D: api/fields/file_grant_fields.py:10]

**DOM-001-R4** — I: Redis lock wrapper that automatically renews TTL while held (migration-only). Notes: - We force `thread_local=False` when creating the underlying redis-py lock, because the lock token must be accessible from the heartbeat thread for `reacquire()` to work. - `release_safely()` is best-effort: it neve — basis: stated in a comment at the enforcement site [D: api/libs/db_migration_lock.py:37]

**DOM-001-R5** — I: y must be 0, but we MUST NOT check it here in order not to allow attacks like Manger's (http://dl.acm.org/citation.cfm?id=704143) — basis: stated in a comment at the enforcement site [D: api/libs/gmpy2_pkcs10aep_cipher.py:183]

**DOM-001-R6** — I: Unknown kid is rejected — never fall back to the active kid, since a past kid value would otherwise be forgeable by anyone who saw it. — basis: stated in a comment at the enforcement site [D: api/libs/jws.py:83]

**DOM-001-R7** — I: Tokens created before this deployment only have the legacy per-token key. This fallback gives those in-flight tokens the same atomic attempt budget. A versioned token is never accepted here, so a consumed v2 challenge cannot fall back even if a stale legacy key is present unexpectedly. — basis: stated in a comment at the enforcement site [D: api/services/email_code_login_challenge.py:93]

**DOM-001-R8** — I: Range is never honoured here, so the hint must not be advertised either. — basis: stated in a comment at the enforcement site [D: api/tests/unit_tests/controllers/files/test_appdeploy_files.py:770]

**DOM-001-R9** — I: Test validation fails when both inputs and outputs are disabled. At least one of inputs_config or outputs_config must be enabled, otherwise the moderation serves no purpose. — basis: stated in a comment at the enforcement site [D: api/tests/unit_tests/core/moderation/test_content_moderation.py:1258]

**DOM-001-R10** — I: Unit tests for PluginEndpointClient functionality. This test module covers the endpoint client operations including: - Successful endpoint deletion - Idempotent delete behavior (record not found) - Non-idempotent delete behavior (other errors) Tests follow the Arrange-Act-Assert pattern for clarity. — basis: stated in a comment at the enforcement site [D: api/tests/unit_tests/core/plugin/test_endpoint_client.py:1]

…37 further rule-bearing comments are quoted in `architect/feature_v1.17_F-001_architect.md` and the survey.

OPEN: every rule above states *what*; none states *why*. Which are regulatory, which are product decisions, and which are workarounds?

## Process flow

Recoverable only as call sequence, not as a business process. See `architect/feature_v1.17_F-001_architect.md` and the endpoint table in `data/api-contract_v1.17_F-001.md`.

OPEN: what is the intended happy path from a user's point of view? A route table gives the operations, never the order a person performs them in.

## Invariants

Enforced by the database for this feature: 212 not-null columns and 5 cross-column uniqueness constraints [D: api/models/].

- `account_trial_app_records` is unique on (`account_id`, `app_id`) [D: api/models/model.py:1026]
- `app_mcp_servers` is unique on (`tenant_id`, `app_id`) [D: api/models/model.py:2122]
- `app_mcp_servers` is unique on (`server_code`) [D: api/models/model.py:2122]
- `app_stars` is unique on (`tenant_id`, `account_id`, `app_id`) [D: api/models/model.py:695]
- `trial_apps` is unique on (`app_id`) [D: api/models/model.py:1003]

I: referential invariants between these tables are enforced in service code, not by the database — basis: only 8 `ForeignKey()` declarations exist across all 143 tables [D: api/models/].

OPEN: which invariants does the business require that nothing in the code checks? Those are the ones a bad migration or a direct database write would break silently.

## Implementation status

One row per rule above. States and what `done` costs: `status-model.md`.

| Rule | Status | Evidence |
| --- | --- | --- |
| DOM-001-R1 | todo | — |
| DOM-001-R2 | todo | — |
| DOM-001-R3 | todo | — |
| DOM-001-R4 | todo | — |
| DOM-001-R5 | todo | — |
| DOM-001-R6 | todo | — |
| DOM-001-R7 | todo | — |
| DOM-001-R8 | todo | — |
| DOM-001-R9 | todo | — |
| DOM-001-R10 | todo | — |

## Open questions

- OPEN: is this feature boundary the one the team recognises? It was drawn from handler directories and table ownership, not from anyone's statement of the domain.
- OPEN: no rule in this document is named by any test. Which of them are actually verified, and which only exist as prose next to the code?
- OPEN: what is the source of truth when a comment and the code beside it disagree?
