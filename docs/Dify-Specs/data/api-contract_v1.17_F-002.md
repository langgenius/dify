---
title: API Contract v1.17 F-002 — Workflow Engine and Authoring
id: F-002
status: draft
owner: TBD
updated: 2026-09-20
---

# API Contract v1.17 F-002 — Workflow Engine and Authoring

> As-built. Paths are composed: Blueprint `url_prefix` + the literal in the route decorator.

## Surface summary

182 operations over 136 paths [D: api/controllers/].

- 143 on the Console API (browser session, `/console/api`) [D: api/controllers/console/__init__.py]
- 21 on the Trigger ingress (`/triggers`) [D: api/controllers/trigger/__init__.py]
- 8 on the Service API (API key, `/v1`) [D: api/controllers/service_api/__init__.py]
- 7 on the Web App API (passport token, `/api`) [D: api/controllers/web/__init__.py]
- 3 on the Public OAuth API (scopes, `/openapi/v1`) [D: api/controllers/openapi/__init__.py]

157 of these carry at least one guard decorator; 25 carry none [D: api/controllers/].

This feature deliberately exposes no other surface: the table below is the complete set of routes whose handler files belong to it.

## Endpoints

| Method | Path | Auth guards | Handler |
| --- | --- | --- | --- |
| `GET` | `/api/form/human_input/<string:form_token>` | public / token-in-URL | `api/controllers/web/human_input_form.py:141` |
| `POST` | `/api/form/human_input/<string:form_token>` | public / token-in-URL | `api/controllers/web/human_input_form.py:141` |
| `POST` | `/api/form/human_input/<string:form_token>/upload-token` | public / token-in-URL | `api/controllers/web/human_input_form.py:100` |
| `POST` | `/api/human-input-forms/files` | public / token-in-URL | `api/controllers/web/human_input_file_upload.py:183` |
| `ANY` | `/api/workflow/<string:task_id>/events` | `@base:WebApiResource (web app passport)` | `api/controllers/web/workflow_events.py:120` |
| `POST` | `/api/workflows/run` | `@base:WebApiResource (web app passport)` | `api/controllers/web/workflow.py:45` |
| `POST` | `/api/workflows/tasks/<string:task_id>/stop` | `@base:WebApiResource (web app passport)` | `api/controllers/web/workflow.py:104` |
| `GET` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflow-runs` | `@console_account_admission` | `api/controllers/console/app/workflow_run.py:138` |
| `GET` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflow-runs/count` | `@console_account_admission` | `api/controllers/console/app/workflow_run.py:172` |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/form/preview` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:975` |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/form/run` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1007` |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/iteration/nodes/<string:node_id>/run` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:750` |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/loop/nodes/<string:node_id>/run` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:848` |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/run` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:698` |
| `POST` | `/console/api/apps/<uuid:app_id>/convert-to-workflow` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1402` |
| `POST` | `/console/api/apps/<uuid:app_id>/trigger-enable` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_trigger.py:167` |
| `GET` | `/console/api/apps/<uuid:app_id>/triggers` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_trigger.py:128` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow-app-logs` | `@console_account_admission` | `api/controllers/console/app/workflow_app_log.py:121` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow-runs` | `@console_account_admission` | `api/controllers/console/app/workflow_run.py:203` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>` | `@console_account_admission` | `api/controllers/console/app/workflow_run.py:267` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>/node-executions` | `@console_account_admission` | `api/controllers/console/app/workflow_run.py:298` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow-runs/count` | `@console_account_admission` | `api/controllers/console/app/workflow_run.py:236` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflow-runs/tasks/<string:task_id>/stop` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1188` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow/comments` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/workflow_comment.py:289` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflow/comments` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/workflow_comment.py:289` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/workflow/comments/<string:comment_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/workflow_comment.py:346` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow/comments/<string:comment_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/workflow_comment.py:346` |
| `PUT` | `/console/api/apps/<uuid:app_id>/workflow/comments/<string:comment_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/workflow_comment.py:346` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflow/comments/<string:comment_id>/replies` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/workflow_comment.py:454` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/workflow/comments/<string:comment_id>/replies/<string:reply_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/workflow_comment.py:495` |
| `PUT` | `/console/api/apps/<uuid:app_id>/workflow/comments/<string:comment_id>/replies/<string:reply_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/workflow_comment.py:495` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflow/comments/<string:comment_id>/resolve` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/workflow_comment.py:427` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow/comments/mention-users` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/workflow_comment.py:568` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow/statistics/average-app-interactions` | `@console_account_admission` | `api/controllers/console/app/workflow_statistic.py:184` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow/statistics/daily-conversations` | `@console_account_admission` | `api/controllers/console/app/workflow_statistic.py:97` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow/statistics/daily-terminals` | `@console_account_admission` | `api/controllers/console/app/workflow_statistic.py:126` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflow/statistics/token-costs` | `@console_account_admission` | `api/controllers/console/app/workflow_statistic.py:155` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1477` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/workflows/<string:workflow_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1569` |
| `PATCH` | `/console/api/apps/<uuid:app_id>/workflows/<string:workflow_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1569` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/<string:workflow_id>/restore` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1530` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/default-workflow-block-configs` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1341` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/default-workflow-block-configs/<string:block_type>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1366` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:573` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:573` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft/conversation-variables` | `@_api_prerequisite`, `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_draft_variable.py:500` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/conversation-variables` | `@_api_prerequisite`, `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_draft_variable.py:500` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft/environment-variables` | `@_api_prerequisite`, `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_draft_variable.py:585` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/environment-variables` | `@_api_prerequisite`, `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_draft_variable.py:585` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/features` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1445` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/delivery-test` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1111` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/preview` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1043` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/run` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1075` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/iteration/nodes/<string:node_id>/run` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:799` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/loop/nodes/<string:node_id>/run` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:892` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/last-run` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1657` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/run` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1216` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/trigger/run` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1763` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/variables` | `@_api_prerequisite`, `@rbac_permission_required` | `api/controllers/console/app/workflow_draft_variable.py:275` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/variables` | `@_api_prerequisite`, `@rbac_permission_required` | `api/controllers/console/app/workflow_draft_variable.py:275` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/run` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1142` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft/runs/<uuid:run_id>/node-outputs` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_node_output_inspector.py:148` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft/runs/<uuid:run_id>/node-outputs/<string:node_id>` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_node_output_inspector.py:166` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft/runs/<uuid:run_id>/node-outputs/<string:node_id>/<string:output_name>/preview` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_node_output_inspector.py:190` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft/runs/<uuid:run_id>/node-outputs/events` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_node_output_inspector.py:340` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft/system-variables` | `@_api_prerequisite`, `@rbac_permission_required` | `api/controllers/console/app/workflow_draft_variable.py:566` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/trigger/run` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1691` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/trigger/run-all` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1847` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/workflows/draft/variables` | `@_api_prerequisite`, `@rbac_permission_required` | `api/controllers/console/app/workflow_draft_variable.py:205` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft/variables` | `@_api_prerequisite`, `@rbac_permission_required` | `api/controllers/console/app/workflow_draft_variable.py:205` |
| `DELETE` | `/console/api/apps/<uuid:app_id>/workflows/draft/variables/<uuid:variable_id>` | `@_api_prerequisite`, `@rbac_permission_required` | `api/controllers/console/app/workflow_draft_variable.py:309` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/draft/variables/<uuid:variable_id>` | `@_api_prerequisite`, `@rbac_permission_required` | `api/controllers/console/app/workflow_draft_variable.py:309` |
| `PATCH` | `/console/api/apps/<uuid:app_id>/workflows/draft/variables/<uuid:variable_id>` | `@_api_prerequisite`, `@rbac_permission_required` | `api/controllers/console/app/workflow_draft_variable.py:309` |
| `PUT` | `/console/api/apps/<uuid:app_id>/workflows/draft/variables/<uuid:variable_id>/reset` | `@_api_prerequisite` | `api/controllers/console/app/workflow_draft_variable.py:443` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/publish` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1270` |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/publish` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1270` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/published/runs/<uuid:run_id>/node-outputs` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_node_output_inspector.py:371` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/published/runs/<uuid:run_id>/node-outputs/<string:node_id>` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_node_output_inspector.py:393` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/published/runs/<uuid:run_id>/node-outputs/<string:node_id>/<string:output_name>/preview` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_node_output_inspector.py:417` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/published/runs/<uuid:run_id>/node-outputs/events` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_node_output_inspector.py:445` |
| `GET` | `/console/api/apps/<uuid:app_id>/workflows/triggers/webhook` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/app/workflow_trigger.py:94` |
| `POST` | `/console/api/apps/workflows/online-users` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/app/workflow.py:1921` |
| `GET` | `/console/api/form/human_input/<string:form_token>` | `@account_initialization_required`, `@login_required`, `@setup_required`, `@staticmethod` | `api/controllers/console/human_input_form.py:70` |
| `POST` | `/console/api/form/human_input/<string:form_token>` | `@account_initialization_required`, `@login_required`, `@setup_required`, `@staticmethod` | `api/controllers/console/human_input_form.py:70` |
| `POST` | `/console/api/installed-apps/<uuid:installed_app_id>/workflows/run` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/workflow.py:44` |
| `POST` | `/console/api/installed-apps/<uuid:installed_app_id>/workflows/tasks/<string:task_id>/stop` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/workflow.py:98` |
| `GET` | `/console/api/oauth/plugin/<path:provider>/trigger/callback` | `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:641` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflow-runs` | `@account_initialization_required`, `@get_snippet`, `@login_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:505` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflow-runs/<uuid:run_id>` | `@account_initialization_required`, `@get_snippet`, `@login_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:540` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflow-runs/<uuid:run_id>/node-executions` | `@account_initialization_required`, `@get_snippet`, `@login_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:569` |
| `POST` | `/console/api/snippets/<uuid:snippet_id>/workflow-runs/tasks/<string:task_id>/stop` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:837` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:342` |
| `DELETE` | `/console/api/snippets/<uuid:snippet_id>/workflows/<string:workflow_id>` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:425` |
| `PATCH` | `/console/api/snippets/<uuid:snippet_id>/workflows/<string:workflow_id>` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:425` |
| `POST` | `/console/api/snippets/<uuid:snippet_id>/workflows/<string:workflow_id>/restore` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:386` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows/default-workflow-block-configs` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:323` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:164` |
| `POST` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:164` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/config` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:238` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/conversation-variables` | `@_snippet_draft_var_prerequisite` | `api/controllers/console/snippets/snippet_workflow_draft_variable.py:304` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/environment-variables` | `@_snippet_draft_var_prerequisite` | `api/controllers/console/snippets/snippet_workflow_draft_variable.py:336` |
| `POST` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/iteration/nodes/<string:node_id>/run` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:690` |
| `POST` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/loop/nodes/<string:node_id>/run` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:742` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/last-run` | `@account_initialization_required`, `@get_snippet`, `@login_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:652` |
| `POST` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/run` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:596` |
| `DELETE` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/variables` | `@_snippet_draft_var_prerequisite` | `api/controllers/console/snippets/snippet_workflow_draft_variable.py:140` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/variables` | `@_snippet_draft_var_prerequisite` | `api/controllers/console/snippets/snippet_workflow_draft_variable.py:140` |
| `POST` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/run` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:793` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/system-variables` | `@_snippet_draft_var_prerequisite` | `api/controllers/console/snippets/snippet_workflow_draft_variable.py:320` |
| `DELETE` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/variables` | `@_snippet_draft_var_prerequisite` | `api/controllers/console/snippets/snippet_workflow_draft_variable.py:98` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/variables` | `@_snippet_draft_var_prerequisite` | `api/controllers/console/snippets/snippet_workflow_draft_variable.py:98` |
| `DELETE` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/variables/<uuid:variable_id>` | `@_snippet_draft_var_prerequisite` | `api/controllers/console/snippets/snippet_workflow_draft_variable.py:170` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/variables/<uuid:variable_id>` | `@_snippet_draft_var_prerequisite` | `api/controllers/console/snippets/snippet_workflow_draft_variable.py:170` |
| `PATCH` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/variables/<uuid:variable_id>` | `@_snippet_draft_var_prerequisite` | `api/controllers/console/snippets/snippet_workflow_draft_variable.py:170` |
| `PUT` | `/console/api/snippets/<uuid:snippet_id>/workflows/draft/variables/<uuid:variable_id>/reset` | `@_snippet_draft_var_prerequisite` | `api/controllers/console/snippets/snippet_workflow_draft_variable.py:269` |
| `GET` | `/console/api/snippets/<uuid:snippet_id>/workflows/publish` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:258` |
| `POST` | `/console/api/snippets/<uuid:snippet_id>/workflows/publish` | `@account_initialization_required`, `@edit_permission_required`, `@get_snippet`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/snippets/snippet_workflow.py:258` |
| `GET` | `/console/api/workflow-run-archives` | `@cloud_edition_billing_paid_plan_required`, `@console_account_admission` | `api/controllers/console/workflow_run_archive.py:93` |
| `POST` | `/console/api/workflow-run-archives/downloads` | `@cloud_edition_billing_paid_plan_required`, `@console_account_admission` | `api/controllers/console/workflow_run_archive.py:108` |
| `GET` | `/console/api/workflow-run-archives/downloads/<string:download_id>` | `@cloud_edition_billing_paid_plan_required`, `@console_account_admission` | `api/controllers/console/workflow_run_archive.py:136` |
| `GET` | `/console/api/workflow-run-archives/downloads/<string:download_id>/file` | `@cloud_edition_billing_paid_plan_required`, `@console_account_admission` | `api/controllers/console/workflow_run_archive.py:157` |
| `GET` | `/console/api/workflow/<string:workflow_run_id>/events` | `@account_initialization_required`, `@login_required` | `api/controllers/console/human_input_form.py:155` |
| `GET` | `/console/api/workflow/<string:workflow_run_id>/pause-details` | `@console_account_admission` | `api/controllers/console/app/workflow_run.py:326` |
| `GET` | `/console/api/workspaces/current/customized-snippets` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/snippets.py:112` |
| `POST` | `/console/api/workspaces/current/customized-snippets` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/snippets.py:112` |
| `DELETE` | `/console/api/workspaces/current/customized-snippets/<uuid:snippet_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/snippets.py:189` |
| `GET` | `/console/api/workspaces/current/customized-snippets/<uuid:snippet_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/snippets.py:189` |
| `PATCH` | `/console/api/workspaces/current/customized-snippets/<uuid:snippet_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/snippets.py:189` |
| `GET` | `/console/api/workspaces/current/customized-snippets/<uuid:snippet_id>/check-dependencies` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/snippets.py:418` |
| `GET` | `/console/api/workspaces/current/customized-snippets/<uuid:snippet_id>/export` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/snippets.py:303` |
| `POST` | `/console/api/workspaces/current/customized-snippets/<uuid:snippet_id>/use-count/increment` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/snippets.py:453` |
| `POST` | `/console/api/workspaces/current/customized-snippets/imports` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/snippets.py:356` |
| `POST` | `/console/api/workspaces/current/customized-snippets/imports/<string:import_id>/confirm` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/snippets.py:394` |
| `GET` | `/console/api/workspaces/current/trigger-provider/<path:provider>/icon` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:146` |
| `GET` | `/console/api/workspaces/current/trigger-provider/<path:provider>/info` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:174` |
| `DELETE` | `/console/api/workspaces/current/trigger-provider/<path:provider>/oauth/client` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:709` |
| `GET` | `/console/api/workspaces/current/trigger-provider/<path:provider>/oauth/client` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:709` |
| `POST` | `/console/api/workspaces/current/trigger-provider/<path:provider>/oauth/client` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:709` |
| `GET` | `/console/api/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/<path:subscription_builder_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:262` |
| `POST` | `/console/api/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/build/<path:subscription_builder_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:412` |
| `POST` | `/console/api/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/create` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:225` |
| `GET` | `/console/api/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/logs/<path:subscription_builder_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:380` |
| `POST` | `/console/api/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/update/<path:subscription_builder_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:334` |
| `POST` | `/console/api/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/verify-and-update/<path:subscription_builder_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:289` |
| `GET` | `/console/api/workspaces/current/trigger-provider/<path:provider>/subscriptions/list` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:191` |
| `GET` | `/console/api/workspaces/current/trigger-provider/<path:provider>/subscriptions/oauth/authorize` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:555` |
| `POST` | `/console/api/workspaces/current/trigger-provider/<path:provider>/subscriptions/verify/<path:subscription_id>` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:816` |
| `POST` | `/console/api/workspaces/current/trigger-provider/<path:subscription_id>/subscriptions/delete` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:519` |
| `POST` | `/console/api/workspaces/current/trigger-provider/<path:subscription_id>/subscriptions/update` | `@account_initialization_required`, `@edit_permission_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:456` |
| `GET` | `/console/api/workspaces/current/triggers` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/trigger_providers.py:158` |
| `GET` | `/openapi/v1/apps/<string:app_id>/human-input-forms/<string:form_token>` | `@endpoint` | `api/controllers/openapi/human_input_form.py:86` |
| `POST` | `/openapi/v1/apps/<string:app_id>/human-input-forms/<string:form_token>:submit` | `@endpoint` | `api/controllers/openapi/human_input_form.py:111` |
| `GET` | `/openapi/v1/apps/<string:app_id>/tasks/<string:task_id>/events` | `@endpoint` | `api/controllers/openapi/workflow_events.py:53` |
| `DELETE` | `/triggers/plugin/<string:endpoint_id>` | public / token-in-URL | `api/controllers/trigger/trigger.py:17` |
| `GET` | `/triggers/plugin/<string:endpoint_id>` | public / token-in-URL | `api/controllers/trigger/trigger.py:17` |
| `HEAD` | `/triggers/plugin/<string:endpoint_id>` | public / token-in-URL | `api/controllers/trigger/trigger.py:17` |
| `OPTIONS` | `/triggers/plugin/<string:endpoint_id>` | public / token-in-URL | `api/controllers/trigger/trigger.py:17` |
| `PATCH` | `/triggers/plugin/<string:endpoint_id>` | public / token-in-URL | `api/controllers/trigger/trigger.py:17` |
| `POST` | `/triggers/plugin/<string:endpoint_id>` | public / token-in-URL | `api/controllers/trigger/trigger.py:17` |
| `PUT` | `/triggers/plugin/<string:endpoint_id>` | public / token-in-URL | `api/controllers/trigger/trigger.py:17` |
| `DELETE` | `/triggers/webhook-debug/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:95` |
| `GET` | `/triggers/webhook-debug/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:95` |
| `HEAD` | `/triggers/webhook-debug/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:95` |
| `OPTIONS` | `/triggers/webhook-debug/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:95` |
| `PATCH` | `/triggers/webhook-debug/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:95` |
| `POST` | `/triggers/webhook-debug/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:95` |
| `PUT` | `/triggers/webhook-debug/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:95` |
| `DELETE` | `/triggers/webhook/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:59` |
| `GET` | `/triggers/webhook/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:59` |
| `HEAD` | `/triggers/webhook/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:59` |
| `OPTIONS` | `/triggers/webhook/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:59` |
| `PATCH` | `/triggers/webhook/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:59` |
| `POST` | `/triggers/webhook/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:59` |
| `PUT` | `/triggers/webhook/<string:webhook_id>` | public / token-in-URL | `api/controllers/trigger/webhook.py:59` |
| `GET` | `/v1/form/human_input/<string:form_token>` | `@expect_with_user`, `@validate_app_token` | `api/controllers/service_api/app/human_input_form.py:78` |
| `POST` | `/v1/form/human_input/<string:form_token>` | `@expect_with_user`, `@validate_app_token` | `api/controllers/service_api/app/human_input_form.py:78` |
| `GET` | `/v1/workflow/<string:workflow_run_id>/events` | `@event_stream_response`, `@validate_app_token` | `api/controllers/service_api/app/workflow_events.py:60` |
| `POST` | `/v1/workflows/<string:workflow_id>/run` | `@expect_with_user`, `@json_or_event_stream_response`, `@validate_app_token` | `api/controllers/service_api/app/workflow.py:394` |
| `GET` | `/v1/workflows/logs` | `@validate_app_token` | `api/controllers/service_api/app/workflow.py:579` |
| `POST` | `/v1/workflows/run` | `@expect_with_user`, `@json_or_event_stream_response`, `@validate_app_token` | `api/controllers/service_api/app/workflow.py:287` |
| `GET` | `/v1/workflows/run/<string:workflow_run_id>` | `@validate_app_token` | `api/controllers/service_api/app/workflow.py:232` |
| `POST` | `/v1/workflows/tasks/<string:task_id>/stop` | `@expect_user_json`, `@validate_app_token` | `api/controllers/service_api/app/workflow.py:532` |

## Events

| Channel | Direction | Source |
| --- | --- | --- |
| workflow collaboration `status` | Produce | `api/services/workflow_collaboration_service.py:150` |
| workflow collaboration `collaboration_update` | Produce | `api/services/workflow_collaboration_service.py:322` |
| workflow collaboration `graph_update` | Produce | `api/services/workflow_collaboration_service.py:346` |
| workflow collaboration `online_users` | Produce | `api/services/workflow_collaboration_service.py:437` |

OPEN: what delivery guarantee and ordering key do these channels promise? The publisher states neither, and no consumer contract is written down.

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

Entity shapes are `$ref`s into `schema/schemas.json`; `schema/openapi_v1.17_F-002.json` and `schema/asyncapi_v1.17_F-002.json` remain scaffold stubs — see the open question below.

OPEN: should `schema/openapi_v1.17_F-002.json` be filled by hand, or replaced by a pointer to the generated spec? Maintaining a second copy guarantees drift.

## Traceability

Stories in `PRDs/prd_v1.17_F-002-*.md`; test cases in `tests/test_v1.17_F-002.md`.

OPEN: no endpoint in this repository is annotated with the requirement it serves, so the mapping below the story level is inferred from naming alone.
