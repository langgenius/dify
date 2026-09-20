---
title: Feature Architecture v1.17 F-005 — Workspace, Identity and Access
id: F-005
status: draft
owner: TBD
updated: 2026-09-20
---

# Feature Architecture v1.17 F-005 — Workspace, Identity and Access

> As-built. Read with `architect.md` for system context and `architect_common.md` for the enforced layer rules.

## Design approach

I: the tenant is the unit of isolation and everything purchasable or configurable hangs off it — basis: 87 of 143 tables carry `tenant_id`, and credentials, model providers, tools, plugins and RBAC are all tenant-scoped tables reached through `/console/api/workspaces/current` [D: api/models/account.py; api/models/provider.py].

OPEN: why this shape and not another? The code retains no record of what was rejected, and this section states only what the code does.

## Surface

232 operations over 199 paths, on `console` (232) [D: api/controllers/].

Busiest handler modules:

| Module | Operations |
| --- | --- |
| `api/controllers/console/workspace/tool_providers.py` | 42 |
| `api/controllers/console/workspace/plugin.py` | 32 |
| `api/controllers/console/workspace/skills.py` | 25 |
| `api/controllers/console/workspace/account.py` | 22 |
| `api/controllers/console/workspace/rbac.py` | 19 |
| `api/controllers/console/workspace/models.py` | 15 |
| `api/controllers/console/workspace/model_providers.py` | 12 |
| `api/controllers/console/workspace/endpoint.py` | 10 |

Full table in `data/api-contract_v1.17_F-005.md`.

## Components and call direction

Controllers in this feature import these application and domain modules [D: api/controllers/]:

| Module | Imported by N handler files |
| --- | --- |
| `services.entities.model_provider_entities` | 3 |
| `core.entities.provider_entities` | 3 |
| `services` | 3 |
| `services.model_load_balancing_service` | 2 |
| `services.model_provider_service` | 2 |
| `services.workspace_service` | 2 |
| `core.plugin.impl.exc` | 2 |
| `core.db.session_factory` | 2 |
| `services.entities.account_entities` | 2 |
| `services.account_activation_service` | 2 |

The direction is one-way: `controllers -> services -> core -> libs`, enforced by import-linter [D: api/.importlinter:21].

## Stores

35 owned tables; field detail in `data/data-erd_v1.17_F-005.md`:

`account_integrates`, `account_plugin_permissions`, `account_step_by_step_tour_states`, `accounts`, `api_based_extensions`, `api_tokens`, `credential_permissions`, `invitation_codes`, `load_balancing_model_configs`, `oauth_access_tokens`, `oauth_provider_apps`, `provider_credentials`, `provider_model_credentials`, `provider_model_settings`, `provider_models`, `provider_orders`, `providers`, `rate_limit_logs`, `tenant_account_joins`, `tenant_default_models`, `tenant_plugin_auto_upgrade_strategies`, `tenant_preferred_model_providers`, `tenants`, `tool_api_providers`, `tool_builtin_providers`, `tool_conversation_variables`, `tool_files`, `tool_label_bindings`, `tool_mcp_providers`, `tool_model_invokes`, `tool_oauth_system_clients`, `tool_oauth_tenant_clients`, `tool_published_apps`, `tool_workflow_providers`, `whitelists`

## Stated constraints in this feature

20 rule-bearing comments sit in this feature's files. Each is a quote, not a paraphrase; the domain document promotes the ones the code enforces.

- > "Per-request identity published via :data:`_auth_ctx_var`. Subject and scopes derive from the token type, never from the row, so a corrupt row cannot elevate scope." [D: api/libs/oauth_bearer.py:92]
- > "Both a nonexistent app tenant and an existing workspace_id tenant are present; `route_has_app` must select the app-derived rule (and its `Forbidden` status), never fall through to the request-derived `NotFound` rule." [D: api/tests/unit_tests/controllers/openapi/auth/test_loaders.py:141]
- > "The access service refuses a token id owned by another account, and a malformed id never reaches it; the route answers 404 either way, not 403, so session ids cannot be probed across accounts." [D: api/tests/unit_tests/controllers/openapi/test_account.py:28]
- > "Mask a secret token for list responses. Reveal-once: the full secret is only returned by the create endpoint. List endpoints expose just enough (prefix + last 4) to identify a key, never the full value, so an existing key's secret cannot be retrieved after creation." [D: api/controllers/console/apikey.py:63]
- > "Remove a member (DELETE) or change a member's role (PATCH). Self-removal and owner-removal are explicitly rejected by the service layer (CannotOperateSelfError, NoPermissionError) — both surface as 400 per the spec, with the service's message preserved. Owner can never be assigned via PATCH (closed" [D: api/controllers/openapi/workspaces.py:226]
- > "The TiDB Cloud API calls must be bounded: a hanging endpoint must not block cluster provisioning or password rotation forever." [D: api/providers/vdb/vdb-tidb-on-qdrant/tests/unit_tests/test_tidb_on_qdrant_vector.py:232]
- > "Indexed text columns are bounded VARCHARs so the schema is portable across PostgreSQL and MySQL (MySQL cannot index TEXT without a prefix length). 255 chars accommodates RFC-compliant emails and typical OIDC issuer URLs / device labels." [D: api/models/oauth.py:113]
- > "Yield an isolated SQLite session with the parametrized model tables. Pass the required ORM classes through indirect parametrization. The engine is per-test so committed rows and identity-map state cannot leak between provider packages." [D: api/providers/conftest.py:20]
- > "Non-numeric TTFT must not raise and must be omitted, so the span is still built" [D: api/providers/trace/trace-aliyun/tests/unit_tests/aliyun_trace/test_aliyun_trace.py:1040]
- > "A new account cannot be created because the seat limit was reached." [D: api/services/account_errors.py:253]
- > "The refresh token cannot be exchanged for a new session." [D: api/services/account_errors.py:293]
- > "The account is already active and cannot be initialized again." [D: api/services/account_errors.py:61]

…and 8 more in the survey.


## Failure modes

Errors surface as typed exceptions rendered by the blueprint's handler; the guards in the contract table reject before the handler runs [D: api/controllers/].

OPEN: what should a caller do on each failure — retry, back off, or give up? The code raises and the client decides, and no document states the intended client behaviour.

## Observability

Shared for the whole backend: OpenTelemetry, Sentry and structured request logging are attached as extensions [D: api/extensions/ext_otel.py; api/extensions/ext_sentry.py; api/extensions/ext_request_logging.py].

OPEN: which signals in this feature are alerted on? No alert rule lives in this repository.

## Open questions

- OPEN: what are the latency and throughput targets for this feature? None is expressed anywhere.
- OPEN: which of the constraints quoted above are still true? A comment is evidence that someone knew the rule when they wrote it, not that the code beside it still enforces it.
- OPEN: rejected alternatives for this design. Not recoverable from a working tree.
