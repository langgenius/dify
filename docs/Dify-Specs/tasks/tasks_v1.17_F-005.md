---
title: Tasks v1.17 F-005 — Workspace, Identity and Access
id: F-005
status: draft
owner: TBD
updated: 2026-09-20
---

# Tasks v1.17 F-005 — Workspace, Identity and Access

> **As-built inventory, not a plan.** Every task below is already shipped; each points at the artifact that exists. `done-when` is written as the check that *would* prove it, because that is what the status column has to cash — and none of it has been cashed here.

## Tasks

| ID | Task | Artifact | Done-when |
| --- | --- | --- | --- |
| F-005-T001 | 42 operation(s) served by this module | `api/controllers/console/workspace/tool_providers.py` | `make test` green for its matching test module |
| F-005-T002 | 32 operation(s) served by this module | `api/controllers/console/workspace/plugin.py` | `make test` green for its matching test module |
| F-005-T003 | 25 operation(s) served by this module | `api/controllers/console/workspace/skills.py` | `make test` green for its matching test module |
| F-005-T004 | 22 operation(s) served by this module | `api/controllers/console/workspace/account.py` | `make test` green for its matching test module |
| F-005-T005 | 19 operation(s) served by this module | `api/controllers/console/workspace/rbac.py` | `make test` green for its matching test module |
| F-005-T006 | 15 operation(s) served by this module | `api/controllers/console/workspace/models.py` | `make test` green for its matching test module |
| F-005-T007 | 12 operation(s) served by this module | `api/controllers/console/workspace/model_providers.py` | `make test` green for its matching test module |
| F-005-T008 | 10 operation(s) served by this module | `api/controllers/console/workspace/endpoint.py` | `make test` green for its matching test module |
| F-005-T009 | 9 operation(s) served by this module | `api/controllers/console/workspace/workspace.py` | `make test` green for its matching test module |
| F-005-T010 | 8 operation(s) served by this module | `api/controllers/console/workspace/members.py` | `make test` green for its matching test module |
| F-005-T011 | 6 operation(s) served by this module | `api/controllers/console/auth/login.py` | `make test` green for its matching test module |
| F-005-T012 | 4 operation(s) served by this module | `api/controllers/console/auth/data_source_oauth.py` | `make test` green for its matching test module |
| F-005-T013 | 4 operation(s) served by this module | `api/controllers/console/auth/oauth_server.py` | `make test` green for its matching test module |
| F-005-T014 | 3 operation(s) served by this module | `api/controllers/console/auth/data_source_bearer_auth.py` | `make test` green for its matching test module |
| F-005-T015 | 3 operation(s) served by this module | `api/controllers/console/apikey.py` | `make test` green for its matching test module |
| F-005-T016 | 3 operation(s) served by this module | `api/controllers/console/billing/billing.py` | `make test` green for its matching test module |
| F-005-T017 | 3 operation(s) served by this module | `api/controllers/console/auth/email_register.py` | `make test` green for its matching test module |
| F-005-T018 | 3 operation(s) served by this module | `api/controllers/console/auth/forgot_password.py` | `make test` green for its matching test module |
| F-005-T019 | 2 operation(s) served by this module | `api/controllers/console/auth/activate.py` | `make test` green for its matching test module |
| F-005-T020 | 2 operation(s) served by this module | `api/controllers/console/auth/oauth.py` | `make test` green for its matching test module |
| F-005-T021 | 2 operation(s) served by this module | `api/controllers/console/workspace/agent_providers.py` | `make test` green for its matching test module |
| F-005-T022 | 2 operation(s) served by this module | `api/controllers/console/workspace/load_balancing_config.py` | `make test` green for its matching test module |
| F-005-T023 | 1 operation(s) served by this module | `api/controllers/console/billing/compliance.py` | `make test` green for its matching test module |
| F-005-T024 | Entity `account_integrates` | `api/models/account.py:320` | migration applies and the ORM class maps it |
| F-005-T025 | Entity `account_plugin_permissions` | `api/models/account.py:385` | migration applies and the ORM class maps it |
| F-005-T026 | Entity `account_step_by_step_tour_states` | `api/models/onboarding.py:13` | migration applies and the ORM class maps it |
| F-005-T027 | Entity `accounts` | `api/models/account.py:89` | migration applies and the ORM class maps it |
| F-005-T028 | Entity `api_based_extensions` | `api/models/api_based_extension.py:20` | migration applies and the ORM class maps it |
| F-005-T029 | Entity `api_tokens` | `api/models/model.py:2254` | migration applies and the ORM class maps it |
| F-005-T030 | Entity `credential_permissions` | `api/models/credential_permission.py:22` | migration applies and the ORM class maps it |
| F-005-T031 | Entity `invitation_codes` | `api/models/account.py:348` | migration applies and the ORM class maps it |
| F-005-T032 | Entity `load_balancing_model_configs` | `api/models/provider.py:274` | migration applies and the ORM class maps it |
| F-005-T033 | Entity `oauth_access_tokens` | `api/models/oauth.py:97` | migration applies and the ORM class maps it |
| F-005-T034 | Entity `oauth_provider_apps` | `api/models/model.py:1074` | migration applies and the ORM class maps it |
| F-005-T035 | Entity `provider_credentials` | `api/models/provider.py:307` | migration applies and the ORM class maps it |
| F-005-T036 | Entity `provider_model_credentials` | `api/models/provider.py:340` | migration applies and the ORM class maps it |
| F-005-T037 | Entity `provider_model_settings` | `api/models/provider.py:244` | migration applies and the ORM class maps it |
| F-005-T038 | Entity `provider_models` | `api/models/provider.py:118` | migration applies and the ORM class maps it |
| F-005-T039 | Entity `provider_orders` | `api/models/provider.py:211` | migration applies and the ORM class maps it |
| F-005-T040 | Entity `providers` | `api/models/provider.py:34` | migration applies and the ORM class maps it |
| F-005-T041 | Entity `rate_limit_logs` | `api/models/dataset.py:1346` | migration applies and the ORM class maps it |
| F-005-T042 | Entity `tenant_account_joins` | `api/models/account.py:292` | migration applies and the ORM class maps it |
| F-005-T043 | Entity `tenant_default_models` | `api/models/provider.py:167` | migration applies and the ORM class maps it |
| F-005-T044 | Entity `tenant_plugin_auto_upgrade_strategies` | `api/models/account.py:431` | migration applies and the ORM class maps it |
| F-005-T045 | Entity `tenant_preferred_model_providers` | `api/models/provider.py:190` | migration applies and the ORM class maps it |
| F-005-T046 | Entity `tenants` | `api/models/account.py:253` | migration applies and the ORM class maps it |
| F-005-T047 | Entity `tool_api_providers` | `api/models/tools.py:134` | migration applies and the ORM class maps it |
| F-005-T048 | Entity `tool_builtin_providers` | `api/models/tools.py:73` | migration applies and the ORM class maps it |
| F-005-T049 | Entity `tool_conversation_variables` | `api/models/tools.py:440` | migration applies and the ORM class maps it |
| F-005-T050 | Entity `tool_files` | `api/models/tools.py:481` | migration applies and the ORM class maps it |
| F-005-T051 | Entity `tool_label_bindings` | `api/models/tools.py:208` | migration applies and the ORM class maps it |
| F-005-T052 | Entity `tool_mcp_providers` | `api/models/tools.py:294` | migration applies and the ORM class maps it |
| F-005-T053 | Entity `tool_model_invokes` | `api/models/tools.py:390` | migration applies and the ORM class maps it |
| F-005-T054 | Entity `tool_oauth_system_clients` | `api/models/tools.py:33` | migration applies and the ORM class maps it |
| F-005-T055 | Entity `tool_oauth_tenant_clients` | `api/models/tools.py:50` | migration applies and the ORM class maps it |
| F-005-T056 | Entity `tool_published_apps` | `api/models/tools.py:514` | migration applies and the ORM class maps it |
| F-005-T057 | Entity `tool_workflow_providers` | `api/models/tools.py:230` | migration applies and the ORM class maps it |
| F-005-T058 | Entity `whitelists` | `api/models/dataset.py:1201` | migration applies and the ORM class maps it |

58 tasks.

## Status

Every row is `todo` in the table above and must move `todo -> wip -> done` through `product-docs-flow/scripts/docs_flow.py task`; the transition guard is the check [D: docs/Dify-Specs/status-model.md].

No row may read `done` without a command and its result in the note.

OPEN: this inventory is one task per module and one per entity. Is that the unit of work the team recognises, or should a task be a user-visible capability? The repository records commits, not tasks.

## Open questions

- OPEN: what was the original sequencing? A working tree preserves the result and not the order.
- OPEN: which of these were delivered together as one release? Tags would say; the repository has none [D: survey of `git tag`].
