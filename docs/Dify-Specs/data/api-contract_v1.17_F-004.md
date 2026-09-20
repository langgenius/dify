---
title: API Contract v1.17 F-004 — Agent
id: F-004
status: draft
owner: TBD
updated: 2026-09-20
---

# API Contract v1.17 F-004 — Agent

> As-built. Paths are composed: Blueprint `url_prefix` + the literal in the route decorator.

## Surface summary

99 operations over 87 paths [D: api/controllers/].

- 89 on the Console API (browser session, `/console/api`) [D: api/controllers/console/__init__.py]
- 10 on the Inner API (`/inner/api`) [D: api/controllers/inner_api/__init__.py]

99 of these carry at least one guard decorator; 0 carry none [D: api/controllers/].

This feature deliberately exposes no other surface: the table below is the complete set of routes whose handler files belong to it.

## Endpoints

| Method | Path | Auth guards | Handler |
| --- | --- | --- | --- |
| `GET` | `/console/api/agent` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:620` |
| `POST` | `/console/api/agent` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:620` |
| `DELETE` | `/console/api/agent/<uuid:agent_id>` | `@account_initialization_required`, `@edit_permission_required`, `@enterprise_license_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:721` |
| `GET` | `/console/api/agent/<uuid:agent_id>` | `@account_initialization_required`, `@edit_permission_required`, `@enterprise_license_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:721` |
| `PUT` | `/console/api/agent/<uuid:agent_id>` | `@account_initialization_required`, `@edit_permission_required`, `@enterprise_license_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:721` |
| `GET` | `/console/api/agent/<uuid:agent_id>/api-access` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:999` |
| `POST` | `/console/api/agent/<uuid:agent_id>/api-enable` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:1013` |
| `GET` | `/console/api/agent/<uuid:agent_id>/api-keys` | `@edit_permission_required`, `@rbac_permission_required` | `api/controllers/console/agent/roster.py:1032` |
| `POST` | `/console/api/agent/<uuid:agent_id>/api-keys` | `@edit_permission_required`, `@rbac_permission_required` | `api/controllers/console/agent/roster.py:1032` |
| `DELETE` | `/console/api/agent/<uuid:agent_id>/api-keys/<uuid:api_key_id>` | `@rbac_permission_required` | `api/controllers/console/agent/roster.py:1062` |
| `POST` | `/console/api/agent/<uuid:agent_id>/audio-to-text` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/audio.py:207` |
| `POST` | `/console/api/agent/<uuid:agent_id>/build-chat/finalize` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/completion.py:283` |
| `DELETE` | `/console/api/agent/<uuid:agent_id>/build-draft` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:876` |
| `GET` | `/console/api/agent/<uuid:agent_id>/build-draft` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:876` |
| `PUT` | `/console/api/agent/<uuid:agent_id>/build-draft` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:876` |
| `POST` | `/console/api/agent/<uuid:agent_id>/build-draft/apply` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:941` |
| `POST` | `/console/api/agent/<uuid:agent_id>/build-draft/checkout` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:846` |
| `GET` | `/console/api/agent/<uuid:agent_id>/chat-messages` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/message.py:170` |
| `POST` | `/console/api/agent/<uuid:agent_id>/chat-messages` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/completion.py:253` |
| `POST` | `/console/api/agent/<uuid:agent_id>/chat-messages/<string:task_id>/stop` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/completion.py:327` |
| `GET` | `/console/api/agent/<uuid:agent_id>/chat-messages/<uuid:message_id>/suggested-questions` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/message.py:317` |
| `GET` | `/console/api/agent/<uuid:agent_id>/composer` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/composer.py:503` |
| `PUT` | `/console/api/agent/<uuid:agent_id>/composer` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/composer.py:503` |
| `GET` | `/console/api/agent/<uuid:agent_id>/composer/candidates` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/composer.py:565` |
| `POST` | `/console/api/agent/<uuid:agent_id>/composer/validate` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/composer.py:542` |
| `GET` | `/console/api/agent/<uuid:agent_id>/config/files` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:801` |
| `POST` | `/console/api/agent/<uuid:agent_id>/config/files` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:801` |
| `DELETE` | `/console/api/agent/<uuid:agent_id>/config/files/<string:name>` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1315` |
| `GET` | `/console/api/agent/<uuid:agent_id>/config/files/<string:name>/download` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1269` |
| `GET` | `/console/api/agent/<uuid:agent_id>/config/files/<string:name>/preview` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1223` |
| `GET` | `/console/api/agent/<uuid:agent_id>/config/manifest` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:668` |
| `GET` | `/console/api/agent/<uuid:agent_id>/config/skills` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:762` |
| `DELETE` | `/console/api/agent/<uuid:agent_id>/config/skills/<string:name>` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1175` |
| `GET` | `/console/api/agent/<uuid:agent_id>/config/skills/<string:name>/download` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1002` |
| `GET` | `/console/api/agent/<uuid:agent_id>/config/skills/<string:name>/files/content` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1124` |
| `GET` | `/console/api/agent/<uuid:agent_id>/config/skills/<string:name>/files/download` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1048` |
| `GET` | `/console/api/agent/<uuid:agent_id>/config/skills/<string:name>/files/preview` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:935` |
| `GET` | `/console/api/agent/<uuid:agent_id>/config/skills/<string:name>/inspect` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:889` |
| `POST` | `/console/api/agent/<uuid:agent_id>/config/skills/upload` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:707` |
| `POST` | `/console/api/agent/<uuid:agent_id>/copy` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:961` |
| `POST` | `/console/api/agent/<uuid:agent_id>/debug-conversation/refresh` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:786` |
| `POST` | `/console/api/agent/<uuid:agent_id>/features` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_app_feature.py:74` |
| `POST` | `/console/api/agent/<uuid:agent_id>/feedbacks` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/message.py:233` |
| `GET` | `/console/api/agent/<uuid:agent_id>/log-sources` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:1212` |
| `GET` | `/console/api/agent/<uuid:agent_id>/logs` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:1133` |
| `GET` | `/console/api/agent/<uuid:agent_id>/logs/<uuid:conversation_id>/messages` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:1172` |
| `GET` | `/console/api/agent/<uuid:agent_id>/messages/<uuid:message_id>` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/message.py:407` |
| `POST` | `/console/api/agent/<uuid:agent_id>/publish` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:815` |
| `GET` | `/console/api/agent/<uuid:agent_id>/referencing-workflows` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_app_access.py:51` |
| `GET` | `/console/api/agent/<uuid:agent_id>/sandbox` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_app_sandbox.py:147` |
| `GET` | `/console/api/agent/<uuid:agent_id>/sandbox/files` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_app_sandbox.py:177` |
| `POST` | `/console/api/agent/<uuid:agent_id>/sandbox/files/download` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_app_sandbox.py:239` |
| `GET` | `/console/api/agent/<uuid:agent_id>/sandbox/files/read` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_app_sandbox.py:208` |
| `GET` | `/console/api/agent/<uuid:agent_id>/statistics/summary` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:1228` |
| `GET` | `/console/api/agent/<uuid:agent_id>/versions` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:1266` |
| `GET` | `/console/api/agent/<uuid:agent_id>/versions/<uuid:version_id>` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:1282` |
| `POST` | `/console/api/agent/<uuid:agent_id>/versions/<uuid:version_id>/restore` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/roster.py:1302` |
| `GET` | `/console/api/agent/invite-options` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/agent/roster.py:1086` |
| `GET` | `/console/api/apps/<uuid:app_id>/agent/config/files` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:851` |
| `POST` | `/console/api/apps/<uuid:app_id>/agent/config/files` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:851` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/agent/config/files/<string:name>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1339` |
| `GET` | `/console/api/apps/<uuid:app_id>/agent/config/files/<string:name>/download` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1293` |
| `GET` | `/console/api/apps/<uuid:app_id>/agent/config/files/<string:name>/preview` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1247` |
| `GET` | `/console/api/apps/<uuid:app_id>/agent/config/manifest` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:690` |
| `GET` | `/console/api/apps/<uuid:app_id>/agent/config/skills` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:784` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/agent/config/skills/<string:name>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1199` |
| `GET` | `/console/api/apps/<uuid:app_id>/agent/config/skills/<string:name>/download` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1026` |
| `GET` | `/console/api/apps/<uuid:app_id>/agent/config/skills/<string:name>/files/content` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1151` |
| `GET` | `/console/api/apps/<uuid:app_id>/agent/config/skills/<string:name>/files/download` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:1087` |
| `GET` | `/console/api/apps/<uuid:app_id>/agent/config/skills/<string:name>/files/preview` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:970` |
| `GET` | `/console/api/apps/<uuid:app_id>/agent/config/skills/<string:name>/inspect` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:913` |
| `POST` | `/console/api/apps/<uuid:app_id>/agent/config/skills/upload` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_config_inspector.py:736` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow-runs/<uuid:workflow_run_id>/agent-nodes/<string:node_id>/sandbox/files` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_app_sandbox.py:276` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflow-runs/<uuid:workflow_run_id>/agent-nodes/<string:node_id>/sandbox/files/download` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_app_sandbox.py:350` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow-runs/<uuid:workflow_run_id>/agent-nodes/<string:node_id>/sandbox/files/read` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/agent_app_sandbox.py:312` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/composer.py:54` |
| `PUT` | `/console/api/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/composer.py:54` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/candidates` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/agent/composer.py:189` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/copy-from-roster` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/composer.py:125` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/impact` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/agent/composer.py:214` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/save-to-roster` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/composer.py:239` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/validate` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/agent/composer.py:167` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/composer.py:288` |
| `PUT` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/composer.py:288` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer/candidates` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/agent/composer.py:414` |
| `POST` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer/copy-from-roster` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/composer.py:353` |
| `POST` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer/impact` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/agent/composer.py:438` |
| `POST` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer/save-to-roster` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/agent/composer.py:465` |
| `POST` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer/validate` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/agent/composer.py:392` |
| `POST` | `/inner/api/agent-config/<string:agent_id>/download-request` | `@plugin_inner_api_only`, `@setup_required` | `api/controllers/inner_api/plugin/agent_config.py:124` |
| `PATCH` | `/inner/api/agent-config/<string:agent_id>/env` | `@plugin_inner_api_only`, `@setup_required` | `api/controllers/inner_api/plugin/agent_config.py:197` |
| `GET` | `/inner/api/agent-config/<string:agent_id>/manifest` | `@plugin_inner_api_only`, `@setup_required` | `api/controllers/inner_api/plugin/agent_config.py:103` |
| `PUT` | `/inner/api/agent-config/<string:agent_id>/note` | `@plugin_inner_api_only`, `@setup_required` | `api/controllers/inner_api/plugin/agent_config.py:219` |
| `POST` | `/inner/api/agent-config/<string:agent_id>/push` | `@plugin_inner_api_only`, `@setup_required` | `api/controllers/inner_api/plugin/agent_config.py:175` |
| `GET` | `/inner/api/agent-config/<string:agent_id>/skills/<string:name>/inspect` | `@plugin_inner_api_only`, `@setup_required` | `api/controllers/inner_api/plugin/agent_config.py:153` |
| `POST` | `/inner/api/agent/files/download-request` | `@plugin_inner_api_only`, `@setup_required` | `api/controllers/inner_api/agent/files.py:143` |
| `POST` | `/inner/api/agent/files/upload-request` | `@plugin_inner_api_only`, `@setup_required` | `api/controllers/inner_api/agent/files.py:86` |
| `POST` | `/inner/api/agent/llm/invoke` | `@agent_inner_api_only` | `api/controllers/inner_api/agent/llm.py:36` |
| `POST` | `/inner/api/agent/tools/invoke` | `@agent_inner_api_only` | `api/controllers/inner_api/agent/tools.py:42` |

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

Entity shapes are `$ref`s into `schema/schemas.json`; `schema/openapi_v1.17_F-004.json` and `schema/asyncapi_v1.17_F-004.json` remain scaffold stubs — see the open question below.

OPEN: should `schema/openapi_v1.17_F-004.json` be filled by hand, or replaced by a pointer to the generated spec? Maintaining a second copy guarantees drift.

## Traceability

Stories in `PRDs/prd_v1.17_F-004-*.md`; test cases in `tests/test_v1.17_F-004.md`.

OPEN: no endpoint in this repository is annotated with the requirement it serves, so the mapping below the story level is inferred from naming alone.
