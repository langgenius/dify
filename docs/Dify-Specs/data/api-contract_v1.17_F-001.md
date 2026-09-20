---
title: API Contract v1.17 F-001 — App Studio and Publishing
id: F-001
status: draft
owner: TBD
updated: 2026-09-20
---

# API Contract v1.17 F-001 — App Studio and Publishing

> As-built. Paths are composed: Blueprint `url_prefix` + the literal in the route decorator.

## Surface summary

112 operations over 89 paths [D: api/controllers/].

- 112 on the Console API (browser session, `/console/api`) [D: api/controllers/console/__init__.py]

110 of these carry at least one guard decorator; 2 carry none [D: api/controllers/].

This feature deliberately exposes no other surface: the table below is the complete set of routes whose handler files belong to it.

## Endpoints

| Method | Path | Auth guards | Handler |
| --- | --- | --- | --- |
| `GET` | `/console/api/api-based-extension` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/extension.py:101` |
| `POST` | `/console/api/api-based-extension` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/extension.py:101` |
| `DELETE` | `/console/api/api-based-extension/<uuid:id>` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/extension.py:143` |
| `GET` | `/console/api/api-based-extension/<uuid:id>` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/extension.py:143` |
| `POST` | `/console/api/api-based-extension/<uuid:id>` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/extension.py:143` |
| `GET` | `/console/api/app-dsl-version` | public / token-in-URL | `api/controllers/console/feature.py:91` |
| `GET` | `/console/api/app/prompt-templates` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/advanced_prompt_template.py:37` |
| `GET` | `/console/api/apps` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@edit_permission_required`, `@enterprise_license_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:638` |
| `POST` | `/console/api/apps` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@edit_permission_required`, `@enterprise_license_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:638` |
| `DELETE` | `/console/api/apps/<uuid:app_id>` | `@account_initialization_required`, `@edit_permission_required`, `@enterprise_license_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:880` |
| `GET` | `/console/api/apps/<uuid:app_id>` | `@account_initialization_required`, `@edit_permission_required`, `@enterprise_license_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:880` |
| `PUT` | `/console/api/apps/<uuid:app_id>` | `@account_initialization_required`, `@edit_permission_required`, `@enterprise_license_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:880` |
| `GET` | `/console/api/apps/<uuid:app_id>/agent/logs` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent.py:76` |
| `POST` | `/console/api/apps/<uuid:app_id>/annotation-reply/<string:action>` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/annotation.py:171` |
| `GET` | `/console/api/apps/<uuid:app_id>/annotation-reply/<string:action>/status/<uuid:job_id>` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/annotation.py:253` |
| `GET` | `/console/api/apps/<uuid:app_id>/annotation-setting` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/annotation.py:200` |
| `POST` | `/console/api/apps/<uuid:app_id>/annotation-settings/<uuid:annotation_setting_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/annotation.py:222` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/annotations` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/annotation.py:286` |
| `GET` | `/console/api/apps/<uuid:app_id>/annotations` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/annotation.py:286` |
| `POST` | `/console/api/apps/<uuid:app_id>/annotations` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/annotation.py:286` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/annotations/<uuid:annotation_id>` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/annotation.py:406` |
| `POST` | `/console/api/apps/<uuid:app_id>/annotations/<uuid:annotation_id>` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/annotation.py:406` |
| `GET` | `/console/api/apps/<uuid:app_id>/annotations/<uuid:annotation_id>/hit-histories` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/annotation.py:539` |
| `POST` | `/console/api/apps/<uuid:app_id>/annotations/batch-import` | `@account_initialization_required`, `@annotation_import_concurrency_limit`, `@annotation_import_rate_limit`, `@cloud_edition_billing_resource_check`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/annotation.py:448` |
| `GET` | `/console/api/apps/<uuid:app_id>/annotations/batch-import-status/<uuid:job_id>` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/annotation.py:508` |
| `GET` | `/console/api/apps/<uuid:app_id>/annotations/count` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/message.py:270` |
| `GET` | `/console/api/apps/<uuid:app_id>/annotations/export` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/annotation.py:376` |
| `POST` | `/console/api/apps/<uuid:app_id>/api-enable` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:1242` |
| `POST` | `/console/api/apps/<uuid:app_id>/audio-to-text` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/audio.py:180` |
| `GET` | `/console/api/apps/<uuid:app_id>/chat-conversations` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/conversation.py:227` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/chat-conversations/<uuid:conversation_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/conversation.py:346` |
| `GET` | `/console/api/apps/<uuid:app_id>/chat-conversations/<uuid:conversation_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/conversation.py:346` |
| `GET` | `/console/api/apps/<uuid:app_id>/chat-messages` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/message.py:145` |
| `POST` | `/console/api/apps/<uuid:app_id>/chat-messages` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/completion.py:229` |
| `POST` | `/console/api/apps/<uuid:app_id>/chat-messages/<string:task_id>/stop` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/completion.py:312` |
| `GET` | `/console/api/apps/<uuid:app_id>/chat-messages/<uuid:message_id>/suggested-questions` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/message.py:293` |
| `GET` | `/console/api/apps/<uuid:app_id>/completion-conversations` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/conversation.py:97` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/completion-conversations/<uuid:conversation_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/conversation.py:177` |
| `GET` | `/console/api/apps/<uuid:app_id>/completion-conversations/<uuid:conversation_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/conversation.py:177` |
| `POST` | `/console/api/apps/<uuid:app_id>/completion-messages` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/completion.py:149` |
| `POST` | `/console/api/apps/<uuid:app_id>/completion-messages/<string:task_id>/stop` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/completion.py:206` |
| `GET` | `/console/api/apps/<uuid:app_id>/conversation-variables` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/conversation_variables.py:88` |
| `POST` | `/console/api/apps/<uuid:app_id>/copy` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:980` |
| `GET` | `/console/api/apps/<uuid:app_id>/export` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:1045` |
| `POST` | `/console/api/apps/<uuid:app_id>/feedbacks` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/message.py:208` |
| `GET` | `/console/api/apps/<uuid:app_id>/feedbacks/export` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/message.py:346` |
| `POST` | `/console/api/apps/<uuid:app_id>/icon` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:1177` |
| `GET` | `/console/api/apps/<uuid:app_id>/messages/<uuid:message_id>` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/message.py:390` |
| `POST` | `/console/api/apps/<uuid:app_id>/model-config` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/model_config.py:77` |
| `POST` | `/console/api/apps/<uuid:app_id>/name` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:1149` |
| `POST` | `/console/api/apps/<uuid:app_id>/publish-to-creators-platform` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:1110` |
| `GET` | `/console/api/apps/<uuid:app_id>/server` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/mcp_server.py:79` |
| `POST` | `/console/api/apps/<uuid:app_id>/server` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/mcp_server.py:79` |
| `PUT` | `/console/api/apps/<uuid:app_id>/server` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/mcp_server.py:79` |
| `POST` | `/console/api/apps/<uuid:app_id>/server/refresh` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/mcp_server.py:181` |
| `POST` | `/console/api/apps/<uuid:app_id>/site` | `@console_account_admission` | `api/controllers/console/app/site.py:97` |
| `POST` | `/console/api/apps/<uuid:app_id>/site-enable` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:1212` |
| `POST` | `/console/api/apps/<uuid:app_id>/site/access-token-reset` | `@console_account_admission` | `api/controllers/console/app/site.py:130` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/star` | `@account_initialization_required`, `@enterprise_license_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/app.py:845` |
| `POST` | `/console/api/apps/<uuid:app_id>/star` | `@account_initialization_required`, `@enterprise_license_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/app.py:845` |
| `GET` | `/console/api/apps/<uuid:app_id>/statistics/average-response-time` | `@console_account_admission` | `api/controllers/console/app/statistic.py:313` |
| `GET` | `/console/api/apps/<uuid:app_id>/statistics/average-session-interactions` | `@console_account_admission` | `api/controllers/console/app/statistic.py:259` |
| `GET` | `/console/api/apps/<uuid:app_id>/statistics/daily-conversations` | `@console_account_admission` | `api/controllers/console/app/statistic.py:178` |
| `GET` | `/console/api/apps/<uuid:app_id>/statistics/daily-end-users` | `@console_account_admission` | `api/controllers/console/app/statistic.py:205` |
| `GET` | `/console/api/apps/<uuid:app_id>/statistics/daily-messages` | `@console_account_admission` | `api/controllers/console/app/statistic.py:151` |
| `GET` | `/console/api/apps/<uuid:app_id>/statistics/token-costs` | `@console_account_admission` | `api/controllers/console/app/statistic.py:232` |
| `GET` | `/console/api/apps/<uuid:app_id>/statistics/tokens-per-second` | `@console_account_admission` | `api/controllers/console/app/statistic.py:340` |
| `GET` | `/console/api/apps/<uuid:app_id>/statistics/user-satisfaction-rate` | `@console_account_admission` | `api/controllers/console/app/statistic.py:286` |
| `POST` | `/console/api/apps/<uuid:app_id>/text-to-audio` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/audio.py:265` |
| `GET` | `/console/api/apps/<uuid:app_id>/text-to-audio/voices` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/audio.py:325` |
| `GET` | `/console/api/apps/<uuid:app_id>/trace` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:1272` |
| `POST` | `/console/api/apps/<uuid:app_id>/trace` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app.py:1272` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/trace-config` | `@console_account_admission` | `api/controllers/console/app/ops_trace.py:90` |
| `GET` | `/console/api/apps/<uuid:app_id>/trace-config` | `@console_account_admission` | `api/controllers/console/app/ops_trace.py:90` |
| `PATCH` | `/console/api/apps/<uuid:app_id>/trace-config` | `@console_account_admission` | `api/controllers/console/app/ops_trace.py:90` |
| `POST` | `/console/api/apps/<uuid:app_id>/trace-config` | `@console_account_admission` | `api/controllers/console/app/ops_trace.py:90` |
| `POST` | `/console/api/apps/imports` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app_import.py:91` |
| `GET` | `/console/api/apps/imports/<string:app_id>/check-dependencies` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app_import.py:292` |
| `POST` | `/console/api/apps/imports/<string:import_id>/confirm` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/app_import.py:237` |
| `GET` | `/console/api/apps/recent` | `@account_initialization_required`, `@enterprise_license_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/app.py:760` |
| `GET` | `/console/api/apps/starred` | `@account_initialization_required`, `@enterprise_license_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/app.py:803` |
| `GET` | `/console/api/code-based-extension` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/extension.py:80` |
| `GET` | `/console/api/features` | `@cloud_utm_record`, `@console_account_admission` | `api/controllers/console/feature.py:41` |
| `GET` | `/console/api/features/vector-space` | `@cloud_utm_record`, `@console_account_admission` | `api/controllers/console/feature.py:57` |
| `GET` | `/console/api/files/<uuid:file_id>/preview` | `@console_account_admission` | `api/controllers/console/files.py:142` |
| `GET` | `/console/api/files/support-type` | `@console_account_admission` | `api/controllers/console/files.py:153` |
| `GET` | `/console/api/files/upload` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@console_account_admission`, `@login_required`, `@setup_required` | `api/controllers/console/files.py:108` |
| `POST` | `/console/api/files/upload` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@console_account_admission`, `@login_required`, `@setup_required` | `api/controllers/console/files.py:108` |
| `POST` | `/console/api/instruction-generate` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/generator.py:327` |
| `POST` | `/console/api/instruction-generate/template` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/generator.py:428` |
| `GET` | `/console/api/notification` | `@console_account_admission` | `api/controllers/console/notification.py:43` |
| `POST` | `/console/api/notification/dismiss` | `@console_account_admission` | `api/controllers/console/notification.py:68` |
| `GET` | `/console/api/onboarding/step-by-step-tour/state` | `@console_account_admission` | `api/controllers/console/onboarding.py:56` |
| `PATCH` | `/console/api/onboarding/step-by-step-tour/state` | `@console_account_admission` | `api/controllers/console/onboarding.py:56` |
| `GET` | `/console/api/remote-files/<path:url>` | `@console_account_admission` | `api/controllers/console/remote_files.py:49` |
| `POST` | `/console/api/remote-files/upload` | `@login_required` | `api/controllers/console/remote_files.py:120` |
| `POST` | `/console/api/rule-code-generate` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/generator.py:263` |
| `POST` | `/console/api/rule-generate` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/generator.py:230` |
| `POST` | `/console/api/rule-structured-output-generate` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/generator.py:295` |
| `GET` | `/console/api/spec/schema-definitions` | `@console_account_admission` | `api/controllers/console/spec.py:30` |
| `GET` | `/console/api/system-features` | public / token-in-URL | `api/controllers/console/feature.py:108` |
| `GET` | `/console/api/system-features/license` | `@console_account_admission` | `api/controllers/console/feature.py:129` |
| `POST` | `/console/api/tag-bindings` | `@console_account_admission` | `api/controllers/console/tag/tags.py:245` |
| `POST` | `/console/api/tag-bindings/remove` | `@console_account_admission` | `api/controllers/console/tag/tags.py:258` |
| `GET` | `/console/api/tags` | `@console_account_admission` | `api/controllers/console/tag/tags.py:128` |
| `POST` | `/console/api/tags` | `@console_account_admission` | `api/controllers/console/tag/tags.py:128` |
| `DELETE` | `/console/api/tags/<uuid:tag_id>` | `@console_account_admission` | `api/controllers/console/tag/tags.py:159` |
| `PATCH` | `/console/api/tags/<uuid:tag_id>` | `@console_account_admission` | `api/controllers/console/tag/tags.py:159` |
| `GET` | `/console/api/trial-models` | `@console_account_admission` | `api/controllers/console/feature.py:73` |
| `POST` | `/console/api/workflow-generate` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/generator.py:481` |
| `POST` | `/console/api/workflow-generate/stream` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/generator.py:570` |
| `POST` | `/console/api/workflow-generate/suggestions` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/generator.py:536` |

## Events

None. No message channel is produced or consumed by this feature's own modules [D: api/controllers/]. Asynchronous work it starts is dispatched as Celery tasks under `api/tasks/`, which is a job queue rather than a published event contract.

## Error model

Errors are raised as Flask-RESTX `HTTPException` subclasses declared per controller package and rendered by the shared handler [D: api/controllers/console/__init__.py:10].

OPEN: is the `{code, message, status}` body a stable public contract, or an implementation detail? Nothing in the repository states which error codes callers may branch on.

## Versioning and compatibility

The Service API is versioned in its mount prefix, `/v1` [D: api/controllers/service_api/__init__.py:6]. The Console API carries no version segment [D: api/controllers/console/__init__.py:10].

I: the Console API is treated as internal to the first-party web client and free to change — basis: it is unversioned while every externally-consumed surface (`/v1`, `/openapi/v1`) carries a version [D: api/controllers/console/__init__.py:10].

OPEN: what is the deprecation window for a `/v1` endpoint? No policy is stated anywhere in the tree.

## Spec files

The repository generates its own OpenAPI documents; those are authoritative for request and response shapes, and this document does not restate them:

- `api/dev/generate_swagger_specs.py` — generator [D: api/dev/generate_swagger_specs.py:1]
- `api/openapi/markdown/{console,service,web,openapi}-openapi.md` — rendered contract [D: api/openapi/markdown/]
- `packages/contracts/generated/api/{console,service,web,openapi}/*.gen.ts` — generated TypeScript types, Zod schemas and oRPC clients [D: packages/contracts/generated/]

Entity shapes are `$ref`s into `schema/schemas.json`; `schema/openapi_v1.17_F-001.json` and `schema/asyncapi_v1.17_F-001.json` remain scaffold stubs — see the open question below.

OPEN: should `schema/openapi_v1.17_F-001.json` be filled by hand, or replaced by a pointer to the generated spec? Maintaining a second copy guarantees drift.

## Traceability

Stories in `PRDs/prd_v1.17_F-001-*.md`; test cases in `tests/test_v1.17_F-001.md`.

OPEN: no endpoint in this repository is annotated with the requirement it serves, so the mapping below the story level is inferred from naming alone.
