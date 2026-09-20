---
title: Feature Architecture v1.17 F-001 — App Studio and Publishing
id: F-001
status: draft
owner: TBD
updated: 2026-09-20
---

# Feature Architecture v1.17 F-001 — App Studio and Publishing

> As-built. Read with `architect.md` for system context and `architect_common.md` for the enforced layer rules.

## Design approach

I: an App is the product's unit of packaging — a row in `apps` carrying a mode, a model configuration or a workflow reference, plus the switches that publish it as a web site or an API — basis: `apps.mode` is an eight-value enum covering every product surface, and `enable_site` / `enable_api` are booleans on the same row [D: api/models/model.py:407].

OPEN: why this shape and not another? The code retains no record of what was rejected, and this section states only what the code does.

## Surface

112 operations over 89 paths, on `console` (112) [D: api/controllers/].

Busiest handler modules:

| Module | Operations |
| --- | --- |
| `api/controllers/console/app/app.py` | 18 |
| `api/controllers/console/app/annotation.py` | 13 |
| `api/controllers/console/app/statistic.py` | 8 |
| `api/controllers/console/app/generator.py` | 8 |
| `api/controllers/console/extension.py` | 6 |
| `api/controllers/console/feature.py` | 6 |
| `api/controllers/console/app/message.py` | 6 |
| `api/controllers/console/app/conversation.py` | 6 |

Full table in `data/api-contract_v1.17_F-001.md`.

## Components and call direction

Controllers in this feature import these application and domain modules [D: api/controllers/]:

| Module | Imported by N handler files |
| --- | --- |
| `services.remote_file_service` | 7 |
| `services.app_ref_service` | 2 |
| `services.app_dsl_service` | 2 |
| `services.enterprise.enterprise_service` | 2 |
| `services.entities.dsl_entities` | 2 |
| `services.errors.account` | 2 |
| `services.feature_service` | 2 |
| `services.system_feature_service` | 2 |
| `core.app.app_config.entities` | 1 |
| `core.errors.error` | 1 |

The direction is one-way: `controllers -> services -> core -> libs`, enforced by import-linter [D: api/.importlinter:21].

## Stores

26 owned tables; field detail in `data/data-erd_v1.17_F-001.md`:

`account_trial_app_records`, `api_requests`, `app_annotation_hit_histories`, `app_annotation_settings`, `app_mcp_servers`, `app_model_configs`, `app_stars`, `apps`, `conversations`, `dify_setups`, `exporle_banners`, `message_agent_thoughts`, `message_annotations`, `message_chains`, `message_feedbacks`, `message_files`, `messages`, `operation_logs`, `recommended_apps`, `sites`, `tag_bindings`, `tags`, `tenant_credit_pools`, `trace_app_config`, `trial_apps`, `upload_files`

## Stated constraints in this feature

47 rule-bearing comments sit in this feature's files. Each is a quote, not a paraphrase; the domain document promotes the ones the code enforces.

- > "Log a warning message to inform the user that the database schema cannot be inspected in offline mode, and the generated SQL may not accurately reflect the actual execution." [D: api/migrations/versions/2024_10_10_0516-bbadea11becb_add_name_and_size_to_tool_files.py:28]
- > "Recorded by the enterprise caller's own audit log; it never enters the grant because a rotated key must not strand the files it uploaded." [D: api/controllers/inner_api/app/file_grants.py:78]
- > "One requested file reference, either resolved or accounted for. The resolve endpoint and optional mint references answer item by item so one missing history file cannot fail a whole run. A file that exists but belongs to another owner is reported exactly like one that never existed." [D: api/fields/file_grant_fields.py:10]
- > "Redis lock wrapper that automatically renews TTL while held (migration-only). Notes: - We force `thread_local=False` when creating the underlying redis-py lock, because the lock token must be accessible from the heartbeat thread for `reacquire()` to work. - `release_safely()` is best-effort: it neve" [D: api/libs/db_migration_lock.py:37]
- > "y must be 0, but we MUST NOT check it here in order not to allow attacks like Manger's (http://dl.acm.org/citation.cfm?id=704143)" [D: api/libs/gmpy2_pkcs10aep_cipher.py:183]
- > "Unknown kid is rejected — never fall back to the active kid, since a past kid value would otherwise be forgeable by anyone who saw it." [D: api/libs/jws.py:83]
- > "Tokens created before this deployment only have the legacy per-token key. This fallback gives those in-flight tokens the same atomic attempt budget. A versioned token is never accepted here, so a consumed v2 challenge cannot fall back even if a stale legacy key is present unexpectedly." [D: api/services/email_code_login_challenge.py:93]
- > "Range is never honoured here, so the hint must not be advertised either." [D: api/tests/unit_tests/controllers/files/test_appdeploy_files.py:770]
- > "Test validation fails when both inputs and outputs are disabled. At least one of inputs_config or outputs_config must be enabled, otherwise the moderation serves no purpose." [D: api/tests/unit_tests/core/moderation/test_content_moderation.py:1258]
- > "Unit tests for PluginEndpointClient functionality. This test module covers the endpoint client operations including: - Successful endpoint deletion - Idempotent delete behavior (record not found) - Non-idempotent delete behavior (other errors) Tests follow the Arrange-Act-Assert pattern for clarity." [D: api/tests/unit_tests/core/plugin/test_endpoint_client.py:1]
- > "Non-enterprise deployments treat the DB selector as a no-op: a stale `identity_mode="idp_token"` row must NOT raise (fail-closed) AND must NOT call the enterprise inner API. The runtime falls through to the legacy provider-identity path." [D: api/tests/unit_tests/core/tools/test_mcp_tool.py:271]
- > "Token-authed: forcing a logout is meaningless and license state must not leak." [D: api/app_factory.py:61]

…and 35 more in the survey.


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
