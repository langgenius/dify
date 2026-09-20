---
title: Domain — Workspace, Identity and Access
id: DOM-005
feature: F-005
kind: domain
status: draft
owner: TBD
updated: 2026-09-20
---

# Domain — Workspace, Identity and Access (DOM-005)

> Reconstructed from the code. Terms are the identifiers the code uses; rules are promoted from comments that state a rule, and each names the code that enforces it.

## Ubiquitous language

The enumerations the schema constrains are the domain's own vocabulary — every value below is a string the database will accept and no other.

| Term | Permitted values | Source |
| --- | --- | --- |
| `account_plugin_permissions.install_permission` | everyone, admins, noone | `api/models/account.py:385` |
| `account_plugin_permissions.debug_permission` | everyone, admins, noone | `api/models/account.py:385` |
| `accounts.status` | pending, uninitialized, active, banned, closed | `api/models/account.py:89` |
| `api_tokens.type` | app, dataset | `api/models/model.py:2254` |
| `invitation_codes.status` | unused, used | `api/models/account.py:348` |
| `load_balancing_model_configs.credential_source_type` | provider, custom_model | `api/models/provider.py:274` |
| `provider_credentials.visibility` | only_me, all_team_members, partial_members | `api/models/provider.py:307` |
| `provider_orders.payment_status` | wait_pay, paid, failed, refunded | `api/models/provider.py:211` |
| `providers.quota_type` | paid, free, trial | `api/models/provider.py:34` |
| `tenant_account_joins.role` | owner, admin, editor, normal, dataset_operator | `api/models/account.py:292` |
| `tenant_plugin_auto_upgrade_strategies.category` | tool, model, extension, agent-strategy, datasource, trigger | `api/models/account.py:431` |
| `tenant_plugin_auto_upgrade_strategies.strategy_setting` | disabled, fix_only, latest | `api/models/account.py:431` |
| `tenant_plugin_auto_upgrade_strategies.upgrade_mode` | all, partial, exclude | `api/models/account.py:431` |
| `tenants.status` | normal, archive | `api/models/account.py:253` |
| `tool_builtin_providers.credential_type` | trigger_subscription, builtin_tool_provider, datasource_provider, provider_credential | `api/models/tools.py:73` |
| `tool_builtin_providers.visibility` | only_me, all_team_members, partial_members | `api/models/tools.py:73` |

OPEN: several enum values carry no visible meaning beyond their spelling. What distinguishes them to a user?

## Actors

| Actor | Does | Evidence |
| --- | --- | --- |
| Workspace owner / admin | manages members, credentials and providers | `api/controllers/console/workspace/workspace.py` |
| Workspace member | operates within granted RBAC permissions | `api/controllers/console/workspace/rbac.py` |
| Operator | installs the instance and configures providers | `api/controllers/console/setup.py` |

OPEN: which of these are distinct personas to the business, and which are the same person in two modes? The code models permissions, not people.

## Business rules

Promoted from 20 rule-bearing comments in this feature's files. Each is `I:` — a comment is evidence that someone knew the rule, not proof the code still enforces it.

**DOM-005-R1** — I: Per-request identity published via :data:`_auth_ctx_var`. Subject and scopes derive from the token type, never from the row, so a corrupt row cannot elevate scope. — basis: stated in a comment at the enforcement site [D: api/libs/oauth_bearer.py:92]

**DOM-005-R2** — I: Both a nonexistent app tenant and an existing workspace_id tenant are present; `route_has_app` must select the app-derived rule (and its `Forbidden` status), never fall through to the request-derived `NotFound` rule. — basis: stated in a comment at the enforcement site [D: api/tests/unit_tests/controllers/openapi/auth/test_loaders.py:141]

**DOM-005-R3** — I: The access service refuses a token id owned by another account, and a malformed id never reaches it; the route answers 404 either way, not 403, so session ids cannot be probed across accounts. — basis: stated in a comment at the enforcement site [D: api/tests/unit_tests/controllers/openapi/test_account.py:28]

**DOM-005-R4** — I: Mask a secret token for list responses. Reveal-once: the full secret is only returned by the create endpoint. List endpoints expose just enough (prefix + last 4) to identify a key, never the full value, so an existing key's secret cannot be retrieved after creation. — basis: stated in a comment at the enforcement site [D: api/controllers/console/apikey.py:63]

**DOM-005-R5** — I: Remove a member (DELETE) or change a member's role (PATCH). Self-removal and owner-removal are explicitly rejected by the service layer (CannotOperateSelfError, NoPermissionError) — both surface as 400 per the spec, with the service's message preserved. Owner can never be assigned via PATCH (closed — basis: stated in a comment at the enforcement site [D: api/controllers/openapi/workspaces.py:226]

**DOM-005-R6** — I: The TiDB Cloud API calls must be bounded: a hanging endpoint must not block cluster provisioning or password rotation forever. — basis: stated in a comment at the enforcement site [D: api/providers/vdb/vdb-tidb-on-qdrant/tests/unit_tests/test_tidb_on_qdrant_vector.py:232]

**DOM-005-R7** — I: Indexed text columns are bounded VARCHARs so the schema is portable across PostgreSQL and MySQL (MySQL cannot index TEXT without a prefix length). 255 chars accommodates RFC-compliant emails and typical OIDC issuer URLs / device labels. — basis: stated in a comment at the enforcement site [D: api/models/oauth.py:113]

**DOM-005-R8** — I: Yield an isolated SQLite session with the parametrized model tables. Pass the required ORM classes through indirect parametrization. The engine is per-test so committed rows and identity-map state cannot leak between provider packages. — basis: stated in a comment at the enforcement site [D: api/providers/conftest.py:20]

**DOM-005-R9** — I: Non-numeric TTFT must not raise and must be omitted, so the span is still built — basis: stated in a comment at the enforcement site [D: api/providers/trace/trace-aliyun/tests/unit_tests/aliyun_trace/test_aliyun_trace.py:1040]

**DOM-005-R10** — I: A new account cannot be created because the seat limit was reached. — basis: stated in a comment at the enforcement site [D: api/services/account_errors.py:253]

…10 further rule-bearing comments are quoted in `architect/feature_v1.17_F-005_architect.md` and the survey.

OPEN: every rule above states *what*; none states *why*. Which are regulatory, which are product decisions, and which are workarounds?

## Process flow

Recoverable only as call sequence, not as a business process. See `architect/feature_v1.17_F-005_architect.md` and the endpoint table in `data/api-contract_v1.17_F-005.md`.

OPEN: what is the intended happy path from a user's point of view? A route table gives the operations, never the order a person performs them in.

## Invariants

Enforced by the database for this feature: 262 not-null columns and 20 cross-column uniqueness constraints [D: api/models/].

- `account_integrates` is unique on (`account_id`, `provider`) [D: api/models/account.py:320]
- `account_integrates` is unique on (`provider`, `open_id`) [D: api/models/account.py:320]
- `account_plugin_permissions` is unique on (`tenant_id`) [D: api/models/account.py:385]
- `account_step_by_step_tour_states` is unique on (`account_id`) [D: api/models/onboarding.py:13]
- `provider_models` is unique on (`tenant_id`, `provider_name`, `model_name`, `model_type`) [D: api/models/provider.py:118]
- `providers` is unique on (`tenant_id`, `provider_name`, `provider_type`, `quota_type`) [D: api/models/provider.py:34]
- `tenant_account_joins` is unique on (`tenant_id`, `account_id`) [D: api/models/account.py:292]
- `tenant_default_models` is unique on (`tenant_id`, `model_type`) [D: api/models/provider.py:167]
- `tenant_plugin_auto_upgrade_strategies` is unique on (`tenant_id`, `category`) [D: api/models/account.py:431]
- `tool_api_providers` is unique on (`name`, `tenant_id`) [D: api/models/tools.py:134]
- `tool_builtin_providers` is unique on (`tenant_id`, `provider`, `name`) [D: api/models/tools.py:73]
- `tool_label_bindings` is unique on (`tool_id`, `label_name`) [D: api/models/tools.py:208]
- `tool_mcp_providers` is unique on (`tenant_id`, `server_url_hash`) [D: api/models/tools.py:294]
- `tool_mcp_providers` is unique on (`tenant_id`, `name`) [D: api/models/tools.py:294]
- `tool_mcp_providers` is unique on (`tenant_id`, `server_identifier`) [D: api/models/tools.py:294]
- `tool_oauth_system_clients` is unique on (`plugin_id`, `provider`) [D: api/models/tools.py:33]
- `tool_oauth_tenant_clients` is unique on (`tenant_id`, `plugin_id`, `provider`) [D: api/models/tools.py:50]
- `tool_published_apps` is unique on (`app_id`, `user_id`) [D: api/models/tools.py:514]
- `tool_workflow_providers` is unique on (`name`, `tenant_id`) [D: api/models/tools.py:230]
- `tool_workflow_providers` is unique on (`tenant_id`, `app_id`) [D: api/models/tools.py:230]

I: referential invariants between these tables are enforced in service code, not by the database — basis: only 8 `ForeignKey()` declarations exist across all 143 tables [D: api/models/].

OPEN: which invariants does the business require that nothing in the code checks? Those are the ones a bad migration or a direct database write would break silently.

## Implementation status

One row per rule above. States and what `done` costs: `status-model.md`.

| Rule | Status | Evidence |
| --- | --- | --- |
| DOM-005-R1 | todo | — |
| DOM-005-R2 | todo | — |
| DOM-005-R3 | todo | — |
| DOM-005-R4 | todo | — |
| DOM-005-R5 | todo | — |
| DOM-005-R6 | todo | — |
| DOM-005-R7 | todo | — |
| DOM-005-R8 | todo | — |
| DOM-005-R9 | todo | — |
| DOM-005-R10 | todo | — |

## Open questions

- OPEN: is this feature boundary the one the team recognises? It was drawn from handler directories and table ownership, not from anyone's statement of the domain.
- OPEN: no rule in this document is named by any test. Which of them are actually verified, and which only exist as prose next to the code?
- OPEN: what is the source of truth when a comment and the code beside it disagree?
