---
title: Feature Architecture v1.17 F-006 — Published App Surfaces
id: F-006
status: draft
owner: TBD
updated: 2026-09-20
---

# Feature Architecture v1.17 F-006 — Published App Surfaces

> As-built. Read with `architect.md` for system context and `architect_common.md` for the enforced layer rules.

## Design approach

I: published surfaces are thin adapters over the same generation core the console uses, differing only in who is authenticated — basis: the web, service and OAuth blueprints all converge on `services.app_generate_service` and `core.app.entities.app_invoke_entities` while each applies a different guard [D: api/controllers/service_api/app/completion.py; api/controllers/web/completion.py:192].

OPEN: why this shape and not another? The code retains no record of what was rejected, and this section states only what the code does.

## Surface

152 operations over 143 paths, on `console` (42), `web` (36), `openapi` (33), `service_api` (30), `files` (10), `mcp` (1) [D: api/controllers/].

Busiest handler modules:

| Module | Operations |
| --- | --- |
| `api/controllers/console/explore/trial.py` | 13 |
| `api/controllers/openapi/workspaces.py` | 7 |
| `api/controllers/service_api/app/annotation.py` | 6 |
| `api/controllers/web/conversation.py` | 5 |
| `api/controllers/web/login.py` | 5 |
| `api/controllers/console/explore/installed_app.py` | 5 |
| `api/controllers/console/explore/conversation.py` | 5 |
| `api/controllers/files/appdeploy_files.py` | 5 |

Full table in `data/api-contract_v1.17_F-006.md`.

## Components and call direction

Controllers in this feature import these application and domain modules [D: api/controllers/]:

| Module | Imported by N handler files |
| --- | --- |
| `core.app.entities.app_invoke_entities` | 10 |
| `core.errors.error` | 9 |
| `services.account_service` | 8 |
| `services.conversation_service` | 6 |
| `services.app_generate_service` | 6 |
| `services.errors.app` | 6 |
| `services.remote_file_service` | 6 |
| `services.errors.message` | 5 |
| `services.app_ref_service` | 4 |
| `services.errors.llm` | 4 |

The direction is one-way: `controllers -> services -> core -> libs`, enforced by import-linter [D: api/.importlinter:21].

## Stores

4 owned tables; field detail in `data/data-erd_v1.17_F-006.md`:

`end_users`, `installed_apps`, `pinned_conversations`, `saved_messages`

## Stated constraints in this feature

2 rule-bearing comments sit in this feature's files. Each is a quote, not a paraphrase; the domain document promotes the ones the code enforces.

- > "`get_datasets_by_ids` resolves the ids it was handed in a single page (`per_page=len(ids)`), so `limit` never bounded this result and there is never a next page to ask for." [D: api/controllers/console/explore/trial.py:918]
- > "Create a workflow app in the account's owner tenant. Workflow mode is used because its template seeds no ``model_config``, so ``AppService.create_app`` never reaches ``ModelManager`` — keeping the fixture free of model-runtime patching." [D: api/tests/test_containers_integration_tests/controllers/openapi/test_apps.py:25]

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
