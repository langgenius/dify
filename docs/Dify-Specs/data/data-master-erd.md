---
title: Master Data Model & ERD — Dify
status: draft
owner: TBD
updated: 2026-09-20
---

# Master Data Model & ERD — Dify

> As-built. Every entity below is a live `__tablename__` in `api/models/`, not a replay of the migration history.

## How this document was derived

The registry is generated from the SQLAlchemy ORM: 143 mapped classes carrying 1560 columns [D: api/models/]. The ORM is preferred over `api/migrations/versions/`, because a migration directory states how the schema got here, not what it is. Reading the revisions yields 149 table names, and 8 of them have no ORM class: `agent_drive_files`, `agent_runtime_sessions`, `data_source_bindings`, `sessions`, `tool_providers`, `tracing_app_configs`, `workflow__conversation_variables`, `workflow_agent_runtime_sessions` [D: api/migrations/versions/].

I: those 8 were dropped or renamed rather than forgotten — basis: one is removed by a revision that says so in its own filename [D: api/migrations/versions/2024_12_19_1746-11b07f66c737_remove_unused_tool_providers.py:35], and two differ from a live table only by spelling (`tracing_app_configs` vs `trace_app_config`, `workflow__conversation_variables` vs `workflow_conversation_variables`). Documenting this schema from migrations would have carried all 8 into the ERD as live tables.

Payload shapes are deliberately absent. The repository generates its own API contract (`api/dev/generate_swagger_specs.py` → `api/openapi/markdown/*.md`; `packages/contracts/generated/**/*.gen.ts`) and that generated output is authoritative for request and response bodies [D: api/dev/generate_swagger_specs.py:1]. Duplicating it here would create a second source that drifts.

## Entity registry

| entity (`schemas.json` `$defs` key) | Owning component | Introduced by | Primary key | Columns | Source |
| --- | --- | --- | --- | --- | --- |
| `account_integrates` | `api/controllers/console/workspace` | F-005 | `id` | 7 | `api/models/account.py:320` |
| `account_plugin_permissions` | `api/controllers/console/workspace` | F-005 | `id` | 4 | `api/models/account.py:385` |
| `account_step_by_step_tour_states` | `api/controllers/console/workspace` | F-005 | `id` | 9 | `api/models/onboarding.py:13` |
| `account_trial_app_records` | `api/controllers/console/app` | F-001 | `id` | 5 | `api/models/model.py:1026` |
| `accounts` | `api/controllers/console/workspace` | F-005 | `id` | 17 | `api/models/account.py:89` |
| `agent_config_drafts` | `api/controllers/console/agent` | F-004 | `id` | 14 | `api/models/agent.py:283` |
| `agent_config_revisions` | `api/controllers/console/agent` | F-004 | `id` | 11 | `api/models/agent.py:363` |
| `agent_config_snapshots` | `api/controllers/console/agent` | F-004 | `id` | 11 | `api/models/agent.py:327` |
| `agent_debug_conversations` | `api/controllers/console/agent` | F-004 | `id` | 9 | `api/models/agent.py:248` |
| `agent_home_snapshots` | `api/controllers/console/agent` | F-004 | `id` | 7 | `api/models/agent.py:218` |
| `agent_skill_binding_snapshots` | `api/controllers/console/agent` | F-004 | `id` | 9 | `api/models/skill.py:158` |
| `agent_skill_bindings` | `api/controllers/console/agent` | F-004 | `id` | 8 | `api/models/skill.py:135` |
| `agent_workspace_bindings` | `api/controllers/console/agent` | F-004 | `id` | 16 | `api/models/agent.py:502` |
| `agent_workspaces` | `api/controllers/console/agent` | F-004 | `id` | 12 | `api/models/agent.py:464` |
| `agents` | `api/controllers/console/agent` | F-004 | `id` | 26 | `api/models/agent.py:140` |
| `api_based_extensions` | `api/controllers/console/workspace` | F-005 | `id` | 6 | `api/models/api_based_extension.py:20` |
| `api_requests` | `api/controllers/console/app` | F-001 | `id` | 8 | `api/models/model.py:2414` |
| `api_tokens` | `api/controllers/console/workspace` | F-005 | `id` | 7 | `api/models/model.py:2254` |
| `app_annotation_hit_histories` | `api/controllers/console/app` | F-001 | `id` | 11 | `api/models/model.py:1959` |
| `app_annotation_settings` | `api/controllers/console/app` | F-001 | `id` | 8 | `api/models/model.py:1996` |
| `app_dataset_joins` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 4 | `api/models/dataset.py:976` |
| `app_mcp_servers` | `api/controllers/console/app` | F-001 | `id` | 10 | `api/models/model.py:2122` |
| `app_model_configs` | `api/controllers/console/app` | F-001 | `id` | 28 | `api/models/model.py:717` |
| `app_stars` | `api/controllers/console/app` | F-001 | `id` | 5 | `api/models/model.py:695` |
| `app_triggers` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 10 | `api/models/trigger.py:435` |
| `apps` | `api/controllers/console/app` | F-001 | `id` | 25 | `api/models/model.py:407` |
| `celery_taskmeta` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 12 | `api/models/task.py:14` |
| `celery_tasksetmeta` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 4 | `api/models/task.py:41` |
| `child_chunks` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 18 | `api/models/dataset.py:919` |
| `conversations` | `api/controllers/console/app` | F-001 | `id` | 25 | `api/models/model.py:1109` |
| `credential_permissions` | `api/controllers/console/workspace` | F-005 | `id` | 7 | `api/models/credential_permission.py:22` |
| `customized_snippets` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 15 | `api/models/snippet.py:26` |
| `data_source_api_key_auth_bindings` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 8 | `api/models/source.py:53` |
| `data_source_oauth_bindings` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 8 | `api/models/source.py:14` |
| `dataset_api_token_bindings` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 4 | `api/models/model.py:2295` |
| `dataset_auto_disable_logs` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 6 | `api/models/dataset.py:1325` |
| `dataset_collection_bindings` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 6 | `api/models/dataset.py:1145` |
| `dataset_keyword_tables` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 4 | `api/models/dataset.py:1058` |
| `dataset_metadata_bindings` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 7 | `api/models/dataset.py:1394` |
| `dataset_metadatas` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 9 | `api/models/dataset.py:1365` |
| `dataset_permissions` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 6 | `api/models/dataset.py:1221` |
| `dataset_process_rules` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 6 | `api/models/dataset.py:394` |
| `dataset_queries` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 8 | `api/models/dataset.py:1001` |
| `dataset_retriever_resources` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 18 | `api/models/model.py:2576` |
| `datasets` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 27 | `api/models/dataset.py:105` |
| `datasource_oauth_params` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 4 | `api/models/oauth.py:15` |
| `datasource_oauth_tenant_params` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 8 | `api/models/oauth.py:69` |
| `datasource_providers` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 14 | `api/models/oauth.py:30` |
| `dify_setups` | `api/controllers/console/app` | F-001 | Version | 5 | `api/models/model.py:361` |
| `document_pipeline_execution_logs` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 9 | `api/models/dataset.py:1517` |
| `document_segment_summaries` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 15 | `api/models/dataset.py:1589` |
| `document_segments` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 25 | `api/models/dataset.py:721` |
| `documents` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 41 | `api/models/dataset.py:438` |
| `embeddings` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 6 | `api/models/dataset.py:1113` |
| `end_users` | `api/controllers/{service_api,web,openapi}` | F-006 | `id` | 10 | `api/models/model.py:2089` |
| `execution_extra_contents` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 6 | `api/models/execution_extra_content.py:17` |
| `exporle_banners` | `api/controllers/console/app` | F-001 | `id` | 7 | `api/models/model.py:1051` |
| `external_knowledge_apis` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 9 | `api/models/dataset.py:1246` |
| `external_knowledge_bindings` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 9 | `api/models/dataset.py:1294` |
| `human_input_form_deliveries` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 7 | `api/models/human_input.py:98` |
| `human_input_form_recipients` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 8 | `api/models/human_input.py:221` |
| `human_input_form_upload_files` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 8 | `api/models/human_input.py:314` |
| `human_input_form_upload_tokens` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 8 | `api/models/human_input.py:283` |
| `human_input_forms` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 19 | `api/models/human_input.py:28` |
| `installed_apps` | `api/controllers/{service_api,web,openapi}` | F-006 | `id` | 8 | `api/models/model.py:974` |
| `invitation_codes` | `api/controllers/console/workspace` | F-005 | `id` | 9 | `api/models/account.py:348` |
| `load_balancing_model_configs` | `api/controllers/console/workspace` | F-005 | `id` | 12 | `api/models/provider.py:274` |
| `message_agent_thoughts` | `api/controllers/console/app` | F-001 | `id` | 27 | `api/models/model.py:2454` |
| `message_annotations` | `api/controllers/console/app` | F-001 | `id` | 10 | `api/models/model.py:1914` |
| `message_chains` | `api/controllers/console/app` | F-001 | `id` | 6 | `api/models/model.py:2435` |
| `message_feedbacks` | `api/controllers/console/app` | F-001 | `id` | 11 | `api/models/model.py:1836` |
| `message_files` | `api/controllers/console/app` | F-001 | `id` | 10 | `api/models/model.py:1886` |
| `messages` | `api/controllers/console/app` | F-001 | `id` | 32 | `api/models/model.py:1442` |
| `oauth_access_tokens` | `api/controllers/console/workspace` | F-005 | `id` | 12 | `api/models/oauth.py:97` |
| `oauth_provider_apps` | `api/controllers/console/workspace` | F-005 | `id` | 9 | `api/models/model.py:1074` |
| `operation_logs` | `api/controllers/console/app` | F-001 | `id` | 8 | `api/models/model.py:2054` |
| `pinned_conversations` | `api/controllers/{service_api,web,openapi}` | F-006 | `id` | 6 | `api/models/web.py:42` |
| `pipeline_built_in_templates` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 13 | `api/models/dataset.py:1417` |
| `pipeline_customized_templates` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 14 | `api/models/dataset.py:1446` |
| `pipeline_recommended_plugins` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 8 | `api/models/dataset.py:1539` |
| `pipelines` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 11 | `api/models/dataset.py:1485` |
| `provider_credentials` | `api/controllers/console/workspace` | F-005 | `id` | 9 | `api/models/provider.py:307` |
| `provider_model_credentials` | `api/controllers/console/workspace` | F-005 | `id` | 9 | `api/models/provider.py:340` |
| `provider_model_settings` | `api/controllers/console/workspace` | F-005 | `id` | 9 | `api/models/provider.py:244` |
| `provider_models` | `api/controllers/console/workspace` | F-005 | `id` | 9 | `api/models/provider.py:118` |
| `provider_orders` | `api/controllers/console/workspace` | F-005 | `id` | 16 | `api/models/provider.py:211` |
| `providers` | `api/controllers/console/workspace` | F-005 | `id` | 12 | `api/models/provider.py:34` |
| `rate_limit_logs` | `api/controllers/console/workspace` | F-005 | `id` | 5 | `api/models/dataset.py:1346` |
| `recommended_apps` | `api/controllers/console/app` | F-001 | `id` | 16 | `api/models/model.py:926` |
| `saved_messages` | `api/controllers/{service_api,web,openapi}` | F-006 | `id` | 6 | `api/models/web.py:14` |
| `segment_attachment_bindings` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 7 | `api/models/dataset.py:1563` |
| `sites` | `api/controllers/console/app` | F-001 | `id` | 25 | `api/models/model.py:2169` |
| `skill_draft_files` | `api/controllers/console/agent` | F-004 | `id` | 12 | `api/models/skill.py:88` |
| `skill_versions` | `api/controllers/console/agent` | F-004 | `id` | 12 | `api/models/skill.py:109` |
| `skills` | `api/controllers/console/agent` | F-004 | `id` | 13 | `api/models/skill.py:56` |
| `tag_bindings` | `api/controllers/console/app` | F-001 | `id` | 6 | `api/models/model.py:2629` |
| `tags` | `api/controllers/console/app` | F-001 | `id` | 6 | `api/models/model.py:2607` |
| `tenant_account_joins` | `api/controllers/console/workspace` | F-005 | `id` | 9 | `api/models/account.py:292` |
| `tenant_credit_pools` | `api/controllers/console/app` | F-001 | `id` | 7 | `api/models/model.py:2694` |
| `tenant_default_models` | `api/controllers/console/workspace` | F-005 | `id` | 7 | `api/models/provider.py:167` |
| `tenant_plugin_auto_upgrade_strategies` | `api/controllers/console/workspace` | F-005 | `id` | 10 | `api/models/account.py:431` |
| `tenant_preferred_model_providers` | `api/controllers/console/workspace` | F-005 | `id` | 6 | `api/models/provider.py:190` |
| `tenants` | `api/controllers/console/workspace` | F-005 | `id` | 8 | `api/models/account.py:253` |
| `tidb_auth_bindings` | `api/controllers/console/datasets` + `api/core/rag` | F-003 | `id` | 10 | `api/models/dataset.py:1170` |
| `tool_api_providers` | `api/controllers/console/workspace` | F-005 | `id` | 14 | `api/models/tools.py:134` |
| `tool_builtin_providers` | `api/controllers/console/workspace` | F-005 | `id` | 12 | `api/models/tools.py:73` |
| `tool_conversation_variables` | `api/controllers/console/workspace` | F-005 | `id` | 7 | `api/models/tools.py:440` |
| `tool_files` | `api/controllers/console/workspace` | F-005 | `id` | 9 | `api/models/tools.py:481` |
| `tool_label_bindings` | `api/controllers/console/workspace` | F-005 | `id` | 4 | `api/models/tools.py:208` |
| `tool_mcp_providers` | `api/controllers/console/workspace` | F-005 | `id` | 17 | `api/models/tools.py:294` |
| `tool_model_invokes` | `api/controllers/console/workspace` | F-005 | `id` | 18 | `api/models/tools.py:390` |
| `tool_oauth_system_clients` | `api/controllers/console/workspace` | F-005 | `id` | 4 | `api/models/tools.py:33` |
| `tool_oauth_tenant_clients` | `api/controllers/console/workspace` | F-005 | `id` | 6 | `api/models/tools.py:50` |
| `tool_published_apps` | `api/controllers/console/workspace` | F-005 | `id` | 11 | `api/models/tools.py:514` |
| `tool_workflow_providers` | `api/controllers/console/workspace` | F-005 | `id` | 13 | `api/models/tools.py:230` |
| `trace_app_config` | `api/controllers/console/app` | F-001 | `id` | 7 | `api/models/model.py:2649` |
| `trial_apps` | `api/controllers/console/app` | F-001 | `id` | 5 | `api/models/model.py:1003` |
| `trigger_oauth_system_clients` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 6 | `api/models/trigger.py:161` |
| `trigger_oauth_tenant_clients` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 8 | `api/models/trigger.py:188` |
| `trigger_subscriptions` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 15 | `api/models/trigger.py:67` |
| `upload_files` | `api/controllers/console/app` | F-001 | `id` | 16 | `api/models/model.py:2324` |
| `whitelists` | `api/controllers/console/workspace` | F-005 | `id` | 4 | `api/models/dataset.py:1201` |
| `workflow_agent_node_bindings` | `api/controllers/console/agent` | F-004 | `id` | 14 | `api/models/agent.py:407` |
| `workflow_app_logs` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 9 | `api/models/workflow.py:1308` |
| `workflow_archive_logs` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 22 | `api/models/workflow.py:1398` |
| `workflow_comment_mentions` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 4 | `api/models/comment.py:187` |
| `workflow_comment_replies` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 6 | `api/models/comment.py:139` |
| `workflow_comments` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 12 | `api/models/comment.py:18` |
| `workflow_conversation_variables` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id`, `conversation_id` | 6 | `api/models/workflow.py:1503` |
| `workflow_draft_variable_files` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 9 | `api/models/workflow.py:2006` |
| `workflow_draft_variables` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 17 | `api/models/workflow.py:1536` |
| `workflow_node_execution_offload` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 7 | `api/models/workflow.py:1199` |
| `workflow_node_executions` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 24 | `api/models/workflow.py:951` |
| `workflow_pause_reasons` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 8 | `api/models/workflow.py:2162` |
| `workflow_pauses` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 7 | `api/models/workflow.py:2094` |
| `workflow_plugin_triggers` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 9 | `api/models/trigger.py:389` |
| `workflow_run_archive_bundles` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 12 | `api/models/workflow.py:1467` |
| `workflow_runs` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 20 | `api/models/workflow.py:790` |
| `workflow_schedule_plans` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 9 | `api/models/trigger.py:484` |
| `workflow_trigger_logs` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 23 | `api/models/trigger.py:221` |
| `workflow_version_counters` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | App_id | 2 | `api/models/workflow.py:749` |
| `workflow_webhook_triggers` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 8 | `api/models/trigger.py:332` |
| `workflows` | `api/controllers/console/app/workflow*` + `api/core/workflow` | F-002 | `id` | 18 | `api/models/workflow.py:177` |

## Master ERD

`schema/erd_master.puml` draws the entities above.

What the diagram cannot show, and this can:

- **Referential integrity is enforced in application code, not by the database.** 371 columns end in `_id`; 8 of them carry a declared `ForeignKey()`, spread over three model files [D: api/models/comment.py, api/models/model.py, api/models/tools.py]. Every other association is a bare `StringUUID` column.
  I: deleting a row does not cascade and orphaned references are possible — basis: with no database-level foreign key there is no `ON DELETE` rule to fire, so cascade behaviour exists only where service code performs it [D: api/models/model.py:407].
- **The tenant is the partition boundary.** 87 of 143 entities carry `tenant_id` [D: api/models/]. Entities without one are either global catalogue rows or children reached through a parent that has one.

## Relationships and cardinality

Only these associations are declared to the database. Every other relationship named in the per-feature ERDs is an application-level convention recovered from query sites, and is marked `I:` there.

| From | Column | To | Declared at |
| --- | --- | --- | --- |
| `dataset_api_token_bindings` | Api_token_id | `api_tokens.id` | `api/models/model.py:2295` |
| `dataset_api_token_bindings` | Dataset_id | `datasets.id` | `api/models/model.py:2295` |
| `message_annotations` | Conversation_id | `conversations.id` | `api/models/model.py:1914` |
| `messages` | Conversation_id | `conversations.id` | `api/models/model.py:1442` |
| `tool_published_apps` | App_id | `apps.id` | `api/models/tools.py:514` |
| `workflow_comment_mentions` | Comment_id | `workflow_comments.id` | `api/models/comment.py:187` |
| `workflow_comment_mentions` | Reply_id | `workflow_comment_replies.id` | `api/models/comment.py:187` |
| `workflow_comment_replies` | Comment_id | `workflow_comments.id` | `api/models/comment.py:139` |

OPEN: which of the 349 undeclared `*_id` columns are intended as hard references and which are deliberately soft (nullable pointers to rows that may legitimately vanish)? The code cannot distinguish the two.

## Identity and keys

- IDs are UUID strings. `DefaultFieldsMixin` issues a UUIDv7 default, while a number of older classes default to `uuid4` inline [D: api/models/base.py:30; api/models/model.py:421].
  I: UUIDv7 was adopted after uuid4 and has not been applied to every table — basis: both defaults are live in the same tree and v7 sits in the shared mixin while v4 sits in per-class overrides [D: api/models/base.py:30].
- 56 cross-column uniqueness constraints are declared in `__table_args__`:

| Entity | Unique on |
| --- | --- |
| `account_integrates` | `account_id`, `provider` |
| `account_integrates` | `provider`, `open_id` |
| `account_plugin_permissions` | Tenant_id |
| `account_step_by_step_tour_states` | Account_id |
| `account_trial_app_records` | `account_id`, `app_id` |
| `agent_config_drafts` | `tenant_id`, `agent_id`, `draft_type`, `draft_owner_key` |
| `agent_config_revisions` | `agent_id`, `revision` |
| `agent_config_snapshots` | `agent_id`, `version` |
| `agent_debug_conversations` | `tenant_id`, `agent_id`, `account_id`, `draft_type` |
| `agent_skill_binding_snapshots` | `tenant_id`, `agent_id`, `config_snapshot_id`, `skill_id` |
| `agent_skill_binding_snapshots` | `tenant_id`, `agent_id`, `config_snapshot_id`, `priority` |
| `agent_skill_bindings` | `tenant_id`, `agent_id`, `skill_id` |
| `agent_skill_bindings` | `tenant_id`, `agent_id`, `priority` |
| `agents` | `tenant_id`, `roster_unique_name` |
| `app_mcp_servers` | `tenant_id`, `app_id` |
| `app_mcp_servers` | Server_code |
| `app_stars` | `tenant_id`, `account_id`, `app_id` |
| `dataset_api_token_bindings` | `api_token_id`, `dataset_id` |
| `datasource_oauth_params` | `plugin_id`, `provider` |
| `datasource_oauth_tenant_params` | `tenant_id`, `plugin_id`, `provider` |
| `datasource_providers` | `tenant_id`, `plugin_id`, `provider`, `name` |
| `embeddings` | `model_name`, `hash`, `provider_name` |
| `human_input_form_upload_files` | Upload_file_id |
| `human_input_form_upload_tokens` | Token |
| `installed_apps` | `tenant_id`, `app_id` |
| `provider_models` | `tenant_id`, `provider_name`, `model_name`, `model_type` |
| `providers` | `tenant_id`, `provider_name`, `provider_type`, `quota_type` |
| `skill_draft_files` | `skill_id`, `path` |
| `skill_versions` | `skill_id`, `version_number` |
| `skills` | `tenant_id`, `name` |
| `tenant_account_joins` | `tenant_id`, `account_id` |
| `tenant_default_models` | `tenant_id`, `model_type` |
| `tenant_plugin_auto_upgrade_strategies` | `tenant_id`, `category` |
| `tool_api_providers` | `name`, `tenant_id` |
| `tool_builtin_providers` | `tenant_id`, `provider`, `name` |
| `tool_label_bindings` | `tool_id`, `label_name` |
| `tool_mcp_providers` | `tenant_id`, `server_url_hash` |
| `tool_mcp_providers` | `tenant_id`, `name` |
| `tool_mcp_providers` | `tenant_id`, `server_identifier` |
| `tool_oauth_system_clients` | `plugin_id`, `provider` |
| `tool_oauth_tenant_clients` | `tenant_id`, `plugin_id`, `provider` |
| `tool_published_apps` | `app_id`, `user_id` |
| `tool_workflow_providers` | `name`, `tenant_id` |
| `tool_workflow_providers` | `tenant_id`, `app_id` |
| `trial_apps` | App_id |
| `trigger_oauth_system_clients` | `plugin_id`, `provider` |
| `trigger_oauth_tenant_clients` | `tenant_id`, `plugin_id`, `provider` |
| `trigger_subscriptions` | `tenant_id`, `provider_id`, `name` |
| `workflow_agent_node_bindings` | `tenant_id`, `workflow_id`, `workflow_version`, `node_id` |
| `workflow_node_execution_offload` | `node_execution_id`, `type` |
| `workflow_pauses` | Workflow_run_id |
| `workflow_plugin_triggers` | `app_id`, `node_id` |
| `workflow_run_archive_bundles` | `tenant_id`, `year`, `month`, `shard`, `bundle_id` |
| `workflow_schedule_plans` | `app_id`, `node_id` |
| `workflow_webhook_triggers` | `app_id`, `node_id` |
| `workflow_webhook_triggers` | Webhook_id |

OPEN: is the id-generation split (uuid7 vs uuid4) a migration in progress or a settled difference? Nothing in the tree states an intent to converge.

## Consistency rules

Traced in `ddd/domain_DOM-*.md`. The database enforces: not-null on required columns, the uniqueness constraints above, and the eight foreign keys. Everything else is a service-layer guard.

OPEN: which invariants are expected to hold across entities that no constraint and no guard enforces? These are the ones a bad migration would silently break.

## Change policy

Schema changes ship as Alembic revisions in `api/migrations/versions/`, and CI runs a dedicated migration job [D: .github/workflows/db-migration-test.yml].

OPEN: what backward-compatibility window applies between an API release and the migration that supports it? OPEN: are migrations expected to be reversible? Many revisions define `downgrade()` but nothing states whether it is exercised.

## Open questions

- OPEN: what is the retention policy for the high-volume log tables (`workflow_node_executions`, `workflow_runs`, `messages`, `api_requests`)? Scheduled cleaners exist for some datasets [D: api/schedule/clean_messages.py:16] but no stated policy sets their horizon.
- OPEN: which entities are the system of record versus a cache of an external system? `embeddings` and the 43 vector-database providers both hold vectors; the code does not say which is authoritative.
- OPEN: `exporle_banners` [D: api/models/model.py] appears to be a misspelling of "explore". Is the table name intentional, and is anything keyed on that exact string?
