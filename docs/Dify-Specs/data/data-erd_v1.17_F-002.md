---
title: Data Model v1.17 F-002 — Workflow Engine and Authoring
id: F-002
status: draft
owner: TBD
updated: 2026-09-20
---

# Data Model v1.17 F-002 — Workflow Engine and Authoring

> The slice of the data model this feature owns, at field precision. Generated from the ORM.

## Scope

33 entities, 358 columns [D: api/models/].

| Entity | Own / read / write | Source |
| --- | --- | --- |
| `app_triggers` | own | `api/models/trigger.py:435` |
| `celery_taskmeta` | own | `api/models/task.py:14` |
| `celery_tasksetmeta` | own | `api/models/task.py:41` |
| `customized_snippets` | own | `api/models/snippet.py:26` |
| `execution_extra_contents` | own | `api/models/execution_extra_content.py:17` |
| `human_input_form_deliveries` | own | `api/models/human_input.py:98` |
| `human_input_form_recipients` | own | `api/models/human_input.py:221` |
| `human_input_form_upload_files` | own | `api/models/human_input.py:314` |
| `human_input_form_upload_tokens` | own | `api/models/human_input.py:283` |
| `human_input_forms` | own | `api/models/human_input.py:28` |
| `trigger_oauth_system_clients` | own | `api/models/trigger.py:161` |
| `trigger_oauth_tenant_clients` | own | `api/models/trigger.py:188` |
| `trigger_subscriptions` | own | `api/models/trigger.py:67` |
| `workflow_app_logs` | own | `api/models/workflow.py:1308` |
| `workflow_archive_logs` | own | `api/models/workflow.py:1398` |
| `workflow_comment_mentions` | own | `api/models/comment.py:187` |
| `workflow_comment_replies` | own | `api/models/comment.py:139` |
| `workflow_comments` | own | `api/models/comment.py:18` |
| `workflow_conversation_variables` | own | `api/models/workflow.py:1503` |
| `workflow_draft_variable_files` | own | `api/models/workflow.py:2006` |
| `workflow_draft_variables` | own | `api/models/workflow.py:1536` |
| `workflow_node_execution_offload` | own | `api/models/workflow.py:1199` |
| `workflow_node_executions` | own | `api/models/workflow.py:951` |
| `workflow_pause_reasons` | own | `api/models/workflow.py:2162` |
| `workflow_pauses` | own | `api/models/workflow.py:2094` |
| `workflow_plugin_triggers` | own | `api/models/trigger.py:389` |
| `workflow_run_archive_bundles` | own | `api/models/workflow.py:1467` |
| `workflow_runs` | own | `api/models/workflow.py:790` |
| `workflow_schedule_plans` | own | `api/models/trigger.py:484` |
| `workflow_trigger_logs` | own | `api/models/trigger.py:221` |
| `workflow_version_counters` | own | `api/models/workflow.py:749` |
| `workflow_webhook_triggers` | own | `api/models/trigger.py:332` |
| `workflows` | own | `api/models/workflow.py:177` |

I: every entity above is owned rather than merely read by this feature — basis: its ORM class is defined in the model module this feature's controllers write through, and no other feature's controllers construct it [D: api/models/].

OPEN: which of these entities are also written by background jobs under `api/tasks/` outside this feature's request path? Ownership at the table level does not settle who writes at runtime.

## Feature ERD

`schema/erd_v1.17_F-002.puml` draws these entities.

## Field definitions

The readable rendering of `schema/schemas.json` `$defs`, which is the single definition of each shape.

### `app_triggers`

ORM class `AppTrigger` [D: api/models/trigger.py:435]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `app_triggers.id` | UUID | Yes | primary key |
| `app_triggers.tenant_id` | UUID | Yes |  |
| `app_triggers.app_id` | UUID | Yes |  |
| `app_triggers.node_id` | String | Yes |  |
| `app_triggers.trigger_type` | String | Yes | enum: unknown |
| `app_triggers.title` | String | Yes |  |
| `app_triggers.provider_name` | String | No |  |
| `app_triggers.status` | String | Yes | enum: enabled, disabled, unauthorized, rate_limited |
| `app_triggers.created_at` | DateTime | Yes |  |
| `app_triggers.updated_at` | DateTime | Yes |  |

### `celery_taskmeta`

ORM class `CeleryTask` [D: api/models/task.py:14]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `celery_taskmeta.id` | Integer | Yes | primary key |
| `celery_taskmeta.task_id` | String | Yes |  |
| `celery_taskmeta.status` | String | No |  |
| `celery_taskmeta.result` | String | No | column type BinaryData |
| `celery_taskmeta.date_done` | DateTime | No |  |
| `celery_taskmeta.traceback` | String | No |  |
| `celery_taskmeta.name` | String | No |  |
| `celery_taskmeta.args` | String | No | column type BinaryData |
| `celery_taskmeta.kwargs` | String | No | column type BinaryData |
| `celery_taskmeta.worker` | String | No |  |
| `celery_taskmeta.retries` | Integer | No |  |
| `celery_taskmeta.queue` | String | No |  |

### `celery_tasksetmeta`

ORM class `CeleryTaskSet` [D: api/models/task.py:41]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `celery_tasksetmeta.id` | Integer | Yes | primary key |
| `celery_tasksetmeta.taskset_id` | String | Yes |  |
| `celery_tasksetmeta.result` | String | No | column type BinaryData |
| `celery_tasksetmeta.date_done` | DateTime | No |  |

### `customized_snippets`

ORM class `CustomizedSnippet` [D: api/models/snippet.py:26]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `customized_snippets.id` | UUID | Yes | primary key |
| `customized_snippets.tenant_id` | UUID | Yes |  |
| `customized_snippets.name` | String | Yes |  |
| `customized_snippets.description` | String | No |  |
| `customized_snippets.type` | String | Yes |  |
| `customized_snippets.workflow_id` | UUID | No |  |
| `customized_snippets.is_published` | Boolean | Yes |  |
| `customized_snippets.version` | Integer | Yes |  |
| `customized_snippets.use_count` | Integer | Yes |  |
| `customized_snippets.icon_info` | Object | No |  |
| `customized_snippets.input_fields` | String | No |  |
| `customized_snippets.created_by` | UUID | No |  |
| `customized_snippets.created_at` | DateTime | Yes |  |
| `customized_snippets.updated_by` | UUID | No |  |
| `customized_snippets.updated_at` | DateTime | Yes |  |

### `execution_extra_contents`

ORM class `ExecutionExtraContent` [D: api/models/execution_extra_content.py:17]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `execution_extra_contents.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `execution_extra_contents.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `execution_extra_contents.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `execution_extra_contents.type` | String | Yes |  |
| `execution_extra_contents.workflow_run_id` | UUID | Yes |  |
| `execution_extra_contents.message_id` | UUID | No |  |

### `human_input_form_deliveries`

ORM class `HumanInputDelivery` [D: api/models/human_input.py:98]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `human_input_form_deliveries.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `human_input_form_deliveries.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `human_input_form_deliveries.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `human_input_form_deliveries.form_id` | UUID | Yes |  |
| `human_input_form_deliveries.delivery_method_type` | String | Yes |  |
| `human_input_form_deliveries.delivery_config_id` | UUID | No |  |
| `human_input_form_deliveries.channel_payload` | String | Yes |  |

### `human_input_form_recipients`

ORM class `HumanInputFormRecipient` [D: api/models/human_input.py:221]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `human_input_form_recipients.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `human_input_form_recipients.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `human_input_form_recipients.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `human_input_form_recipients.form_id` | UUID | Yes |  |
| `human_input_form_recipients.delivery_id` | UUID | Yes |  |
| `human_input_form_recipients.recipient_type` | String | Yes |  |
| `human_input_form_recipients.recipient_payload` | String | Yes |  |
| `human_input_form_recipients.access_token` | String | Yes | column type VARCHAR |

### `human_input_form_upload_files`

ORM class `HumanInputFormUploadFile` [D: api/models/human_input.py:314]. Primary key: `id`.

Unique: (`upload_file_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `human_input_form_upload_files.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `human_input_form_upload_files.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `human_input_form_upload_files.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `human_input_form_upload_files.tenant_id` | UUID | Yes |  |
| `human_input_form_upload_files.app_id` | UUID | Yes |  |
| `human_input_form_upload_files.form_id` | UUID | Yes |  |
| `human_input_form_upload_files.upload_file_id` | UUID | Yes |  |
| `human_input_form_upload_files.upload_token_id` | UUID | Yes |  |

### `human_input_form_upload_tokens`

ORM class `HumanInputFormUploadToken` [D: api/models/human_input.py:283]. Primary key: `id`.

Unique: (`token`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `human_input_form_upload_tokens.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `human_input_form_upload_tokens.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `human_input_form_upload_tokens.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `human_input_form_upload_tokens.tenant_id` | UUID | Yes |  |
| `human_input_form_upload_tokens.app_id` | UUID | Yes |  |
| `human_input_form_upload_tokens.form_id` | UUID | Yes |  |
| `human_input_form_upload_tokens.recipient_id` | UUID | Yes |  |
| `human_input_form_upload_tokens.token` | String | Yes |  |

### `human_input_forms`

ORM class `HumanInputForm` [D: api/models/human_input.py:28]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `human_input_forms.id` | UUID | Yes | primary key (DefaultFieldsMixin) |
| `human_input_forms.created_at` | DateTime | Yes | from DefaultFieldsMixin |
| `human_input_forms.updated_at` | DateTime | Yes | from DefaultFieldsMixin |
| `human_input_forms.tenant_id` | UUID | Yes |  |
| `human_input_forms.app_id` | UUID | Yes |  |
| `human_input_forms.workflow_run_id` | UUID | No |  |
| `human_input_forms.conversation_id` | UUID | No |  |
| `human_input_forms.form_kind` | String | Yes |  |
| `human_input_forms.node_id` | String | Yes |  |
| `human_input_forms.form_definition` | String | Yes |  |
| `human_input_forms.rendered_content` | String | Yes |  |
| `human_input_forms.status` | String | Yes |  |
| `human_input_forms.expiration_time` | DateTime | Yes |  |
| `human_input_forms.selected_action_id` | String | No |  |
| `human_input_forms.submitted_data` | String | No |  |
| `human_input_forms.submitted_at` | DateTime | No |  |
| `human_input_forms.submission_user_id` | UUID | No |  |
| `human_input_forms.submission_end_user_id` | UUID | No |  |
| `human_input_forms.completed_by_recipient_id` | UUID | No |  |

### `trigger_oauth_system_clients`

ORM class `TriggerOAuthSystemClient` [D: api/models/trigger.py:161]. Primary key: `id`.

Unique: (`plugin_id`, `provider`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `trigger_oauth_system_clients.id` | UUID | Yes | primary key |
| `trigger_oauth_system_clients.plugin_id` | String | Yes |  |
| `trigger_oauth_system_clients.provider` | String | Yes |  |
| `trigger_oauth_system_clients.encrypted_oauth_params` | String | Yes |  |
| `trigger_oauth_system_clients.created_at` | DateTime | Yes |  |
| `trigger_oauth_system_clients.updated_at` | DateTime | Yes |  |

### `trigger_oauth_tenant_clients`

ORM class `TriggerOAuthTenantClient` [D: api/models/trigger.py:188]. Primary key: `id`.

Unique: (`tenant_id`, `plugin_id`, `provider`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `trigger_oauth_tenant_clients.id` | UUID | Yes | primary key |
| `trigger_oauth_tenant_clients.tenant_id` | UUID | Yes |  |
| `trigger_oauth_tenant_clients.plugin_id` | String | Yes |  |
| `trigger_oauth_tenant_clients.provider` | String | Yes |  |
| `trigger_oauth_tenant_clients.enabled` | Boolean | Yes |  |
| `trigger_oauth_tenant_clients.encrypted_oauth_params` | String | Yes |  |
| `trigger_oauth_tenant_clients.created_at` | DateTime | Yes |  |
| `trigger_oauth_tenant_clients.updated_at` | DateTime | Yes |  |

### `trigger_subscriptions`

ORM class `TriggerSubscription` [D: api/models/trigger.py:67]. Primary key: `id`.

Unique: (`tenant_id`, `provider_id`, `name`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `trigger_subscriptions.id` | UUID | Yes | primary key |
| `trigger_subscriptions.name` | String | Yes |  |
| `trigger_subscriptions.tenant_id` | UUID | Yes |  |
| `trigger_subscriptions.user_id` | UUID | Yes |  |
| `trigger_subscriptions.provider_id` | String | Yes |  |
| `trigger_subscriptions.endpoint_id` | String | Yes |  |
| `trigger_subscriptions.parameters` | Object | Yes |  |
| `trigger_subscriptions.properties` | Object | Yes |  |
| `trigger_subscriptions.credentials` | Object | Yes |  |
| `trigger_subscriptions.credential_type` | String | Yes | enum: trigger_subscription, builtin_tool_provider, datasource_provider, provider_credential |
| `trigger_subscriptions.credential_expires_at` | Integer | No |  |
| `trigger_subscriptions.expires_at` | Integer | No |  |
| `trigger_subscriptions.visibility` | String | Yes | enum: only_me, all_team_members, partial_members |
| `trigger_subscriptions.created_at` | DateTime | Yes |  |
| `trigger_subscriptions.updated_at` | DateTime | Yes |  |

### `workflow_app_logs`

ORM class `WorkflowAppLog` [D: api/models/workflow.py:1308]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_app_logs.id` | UUID | Yes | primary key |
| `workflow_app_logs.tenant_id` | UUID | Yes |  |
| `workflow_app_logs.app_id` | UUID | Yes |  |
| `workflow_app_logs.workflow_id` | UUID | Yes |  |
| `workflow_app_logs.workflow_run_id` | UUID | Yes |  |
| `workflow_app_logs.created_from` | String | Yes | enum: service-api, web-app, installed-app, openapi |
| `workflow_app_logs.created_by_role` | String | Yes | enum: account, end_user |
| `workflow_app_logs.created_by` | UUID | Yes |  |
| `workflow_app_logs.created_at` | DateTime | Yes |  |

### `workflow_archive_logs`

ORM class `WorkflowArchiveLog` [D: api/models/workflow.py:1398]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_archive_logs.id` | UUID | Yes | primary key |
| `workflow_archive_logs.tenant_id` | UUID | Yes |  |
| `workflow_archive_logs.app_id` | UUID | Yes |  |
| `workflow_archive_logs.workflow_id` | UUID | Yes |  |
| `workflow_archive_logs.workflow_run_id` | UUID | Yes |  |
| `workflow_archive_logs.created_by_role` | String | Yes | enum: account, end_user |
| `workflow_archive_logs.created_by` | UUID | Yes |  |
| `workflow_archive_logs.log_id` | UUID | No |  |
| `workflow_archive_logs.log_created_at` | DateTime | No |  |
| `workflow_archive_logs.log_created_from` | String | No | enum: service-api, web-app, installed-app, openapi |
| `workflow_archive_logs.run_version` | String | Yes |  |
| `workflow_archive_logs.run_status` | String | Yes |  |
| `workflow_archive_logs.run_triggered_from` | String | Yes | enum: debugging, app-run, rag-pipeline-run, rag-pipeline-debugging, webhook, schedule, plugin |
| `workflow_archive_logs.run_error` | String | No |  |
| `workflow_archive_logs.run_elapsed_time` | Number | Yes |  |
| `workflow_archive_logs.run_total_tokens` | Integer | No |  |
| `workflow_archive_logs.run_total_steps` | Integer | No |  |
| `workflow_archive_logs.run_created_at` | DateTime | Yes |  |
| `workflow_archive_logs.run_finished_at` | DateTime | No |  |
| `workflow_archive_logs.run_exceptions_count` | Integer | No |  |
| `workflow_archive_logs.trigger_metadata` | String | No |  |
| `workflow_archive_logs.archived_at` | DateTime | Yes |  |

### `workflow_comment_mentions`

ORM class `WorkflowCommentMention` [D: api/models/comment.py:187]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_comment_mentions.id` | UUID | Yes | primary key |
| `workflow_comment_mentions.comment_id` | UUID | Yes | FK -> workflow_comments.id |
| `workflow_comment_mentions.mentioned_user_id` | UUID | Yes |  |
| `workflow_comment_mentions.reply_id` | UUID | No | FK -> workflow_comment_replies.id |

### `workflow_comment_replies`

ORM class `WorkflowCommentReply` [D: api/models/comment.py:139]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_comment_replies.id` | UUID | Yes | primary key |
| `workflow_comment_replies.comment_id` | UUID | Yes | FK -> workflow_comments.id |
| `workflow_comment_replies.content` | String | Yes |  |
| `workflow_comment_replies.created_by` | UUID | Yes |  |
| `workflow_comment_replies.created_at` | DateTime | Yes |  |
| `workflow_comment_replies.updated_at` | DateTime | Yes |  |

### `workflow_comments`

ORM class `WorkflowComment` [D: api/models/comment.py:18]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_comments.id` | UUID | Yes | primary key |
| `workflow_comments.tenant_id` | UUID | Yes |  |
| `workflow_comments.app_id` | UUID | Yes |  |
| `workflow_comments.position_x` | Number | Yes |  |
| `workflow_comments.position_y` | Number | Yes |  |
| `workflow_comments.content` | String | Yes |  |
| `workflow_comments.created_by` | UUID | Yes |  |
| `workflow_comments.created_at` | DateTime | Yes |  |
| `workflow_comments.updated_at` | DateTime | Yes |  |
| `workflow_comments.resolved_at` | DateTime | No |  |
| `workflow_comments.resolved_by` | UUID | No |  |
| `workflow_comments.resolved` | Boolean | Yes |  |

### `workflow_conversation_variables`

ORM class `ConversationVariable` [D: api/models/workflow.py:1503]. Primary key: `id`, `conversation_id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_conversation_variables.id` | UUID | Yes | primary key |
| `workflow_conversation_variables.conversation_id` | UUID | Yes | primary key |
| `workflow_conversation_variables.app_id` | UUID | Yes |  |
| `workflow_conversation_variables.data` | String | Yes |  |
| `workflow_conversation_variables.created_at` | DateTime | Yes |  |
| `workflow_conversation_variables.updated_at` | DateTime | Yes |  |

### `workflow_draft_variable_files`

ORM class `WorkflowDraftVariableFile` [D: api/models/workflow.py:2006]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_draft_variable_files.id` | UUID | Yes | primary key |
| `workflow_draft_variable_files.tenant_id` | UUID | Yes |  |
| `workflow_draft_variable_files.app_id` | UUID | Yes |  |
| `workflow_draft_variable_files.user_id` | UUID | Yes |  |
| `workflow_draft_variable_files.upload_file_id` | UUID | Yes |  |
| `workflow_draft_variable_files.size` | Integer | Yes |  |
| `workflow_draft_variable_files.length` | Integer | No |  |
| `workflow_draft_variable_files.value_type` | String | Yes | enum: automatic, customized |
| `workflow_draft_variable_files.created_at` | DateTime | Yes |  |

### `workflow_draft_variables`

ORM class `WorkflowDraftVariable` [D: api/models/workflow.py:1536]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_draft_variables.id` | UUID | Yes | primary key |
| `workflow_draft_variables.created_at` | DateTime | Yes |  |
| `workflow_draft_variables.updated_at` | DateTime | Yes |  |
| `workflow_draft_variables.app_id` | UUID | Yes |  |
| `workflow_draft_variables.user_id` | UUID | No |  |
| `workflow_draft_variables.last_edited_at` | DateTime | No |  |
| `workflow_draft_variables.node_id` | String | Yes |  |
| `workflow_draft_variables.name` | String | Yes |  |
| `workflow_draft_variables.description` | String | Yes |  |
| `workflow_draft_variables.selector` | String | Yes |  |
| `workflow_draft_variables.value_type` | String | Yes | enum: automatic, customized |
| `workflow_draft_variables.value` | String | Yes |  |
| `workflow_draft_variables.visible` | Boolean | Yes |  |
| `workflow_draft_variables.editable` | Boolean | Yes |  |
| `workflow_draft_variables.node_execution_id` | UUID | No |  |
| `workflow_draft_variables.file_id` | UUID | No |  |
| `workflow_draft_variables.is_default_value` | Boolean | Yes |  |

### `workflow_node_execution_offload`

ORM class `WorkflowNodeExecutionOffload` [D: api/models/workflow.py:1199]. Primary key: `id`.

Unique: (`node_execution_id`, `type`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_node_execution_offload.id` | UUID | Yes | primary key |
| `workflow_node_execution_offload.created_at` | DateTime | No |  |
| `workflow_node_execution_offload.tenant_id` | UUID | Yes |  |
| `workflow_node_execution_offload.app_id` | UUID | Yes |  |
| `workflow_node_execution_offload.node_execution_id` | UUID | No |  |
| `workflow_node_execution_offload.type_` | String | Yes | enum: inputs, process_data, outputs |
| `workflow_node_execution_offload.file_id` | UUID | Yes |  |

### `workflow_node_executions`

ORM class `WorkflowNodeExecutionModel` [D: api/models/workflow.py:951]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_node_executions.id` | UUID | Yes | primary key |
| `workflow_node_executions.tenant_id` | UUID | Yes |  |
| `workflow_node_executions.app_id` | UUID | Yes |  |
| `workflow_node_executions.workflow_id` | UUID | Yes |  |
| `workflow_node_executions.triggered_from` | String | Yes | enum: single-step, workflow-run, rag-pipeline-run |
| `workflow_node_executions.workflow_run_id` | UUID | No |  |
| `workflow_node_executions.index` | Integer | Yes |  |
| `workflow_node_executions.predecessor_node_id` | String | No |  |
| `workflow_node_executions.node_execution_id` | String | No |  |
| `workflow_node_executions.node_id` | String | Yes |  |
| `workflow_node_executions.node_type` | String | Yes |  |
| `workflow_node_executions.title` | String | Yes |  |
| `workflow_node_executions.agent_workspace_binding_id` | UUID | No |  |
| `workflow_node_executions.inputs` | String | No |  |
| `workflow_node_executions.process_data` | String | No |  |
| `workflow_node_executions.outputs` | String | No |  |
| `workflow_node_executions.status` | String | Yes |  |
| `workflow_node_executions.error` | String | No |  |
| `workflow_node_executions.elapsed_time` | Number | No |  |
| `workflow_node_executions.execution_metadata` | String | No |  |
| `workflow_node_executions.created_at` | DateTime | No |  |
| `workflow_node_executions.created_by_role` | String | Yes | enum: account, end_user |
| `workflow_node_executions.created_by` | UUID | Yes |  |
| `workflow_node_executions.finished_at` | DateTime | No |  |

### `workflow_pause_reasons`

ORM class `WorkflowPauseReason` [D: api/models/workflow.py:2162]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_pause_reasons.id` | UUID | Yes | primary key (DefaultFieldsDCMixin) |
| `workflow_pause_reasons.created_at` | DateTime | Yes | from DefaultFieldsDCMixin |
| `workflow_pause_reasons.updated_at` | DateTime | Yes | from DefaultFieldsDCMixin |
| `workflow_pause_reasons.pause_id` | UUID | Yes |  |
| `workflow_pause_reasons.type_` | String | Yes |  |
| `workflow_pause_reasons.form_id` | String | Yes |  |
| `workflow_pause_reasons.message` | String | Yes |  |
| `workflow_pause_reasons.node_id` | String | Yes |  |

### `workflow_pauses`

ORM class `WorkflowPause` [D: api/models/workflow.py:2094]. Primary key: `id`.

Unique: (`workflow_run_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_pauses.id` | UUID | Yes | primary key (DefaultFieldsDCMixin) |
| `workflow_pauses.created_at` | DateTime | Yes | from DefaultFieldsDCMixin |
| `workflow_pauses.updated_at` | DateTime | Yes | from DefaultFieldsDCMixin |
| `workflow_pauses.workflow_id` | UUID | Yes |  |
| `workflow_pauses.workflow_run_id` | UUID | Yes |  |
| `workflow_pauses.state_object_key` | String | Yes |  |
| `workflow_pauses.resumed_at` | DateTime | No |  |

### `workflow_plugin_triggers`

ORM class `WorkflowPluginTrigger` [D: api/models/trigger.py:389]. Primary key: `id`.

Unique: (`app_id`, `node_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_plugin_triggers.id` | UUID | Yes | primary key |
| `workflow_plugin_triggers.app_id` | UUID | Yes |  |
| `workflow_plugin_triggers.node_id` | String | Yes |  |
| `workflow_plugin_triggers.tenant_id` | UUID | Yes |  |
| `workflow_plugin_triggers.provider_id` | String | Yes |  |
| `workflow_plugin_triggers.event_name` | String | Yes |  |
| `workflow_plugin_triggers.subscription_id` | String | Yes |  |
| `workflow_plugin_triggers.created_at` | DateTime | Yes |  |
| `workflow_plugin_triggers.updated_at` | DateTime | Yes |  |

### `workflow_run_archive_bundles`

ORM class `WorkflowRunArchiveBundle` [D: api/models/workflow.py:1467]. Primary key: `id`.

Unique: (`tenant_id`, `year`, `month`, `shard`, `bundle_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_run_archive_bundles.id` | UUID | Yes | primary key (DefaultFieldsDCMixin) |
| `workflow_run_archive_bundles.created_at` | DateTime | Yes | from DefaultFieldsDCMixin |
| `workflow_run_archive_bundles.updated_at` | DateTime | Yes | from DefaultFieldsDCMixin |
| `workflow_run_archive_bundles.tenant_id` | UUID | Yes |  |
| `workflow_run_archive_bundles.year` | Integer | Yes |  |
| `workflow_run_archive_bundles.month` | Integer | Yes |  |
| `workflow_run_archive_bundles.shard` | String | Yes |  |
| `workflow_run_archive_bundles.bundle_id` | String | Yes |  |
| `workflow_run_archive_bundles.workflow_run_count` | Integer | Yes |  |
| `workflow_run_archive_bundles.row_count` | Integer | Yes |  |
| `workflow_run_archive_bundles.archive_bytes` | Integer | Yes |  |
| `workflow_run_archive_bundles.archived_at` | DateTime | Yes |  |

### `workflow_runs`

ORM class `WorkflowRun` [D: api/models/workflow.py:790]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_runs.id` | UUID | Yes | primary key |
| `workflow_runs.tenant_id` | UUID | Yes |  |
| `workflow_runs.app_id` | UUID | Yes |  |
| `workflow_runs.workflow_id` | UUID | Yes |  |
| `workflow_runs.type` | String | Yes | enum: workflow, chat, rag-pipeline, snippet |
| `workflow_runs.triggered_from` | String | Yes | enum: debugging, app-run, rag-pipeline-run, rag-pipeline-debugging, webhook, schedule, plugin |
| `workflow_runs.version` | String | Yes |  |
| `workflow_runs.graph` | String | No |  |
| `workflow_runs.inputs` | String | No |  |
| `workflow_runs.status` | String | Yes |  |
| `workflow_runs.outputs` | String | No |  |
| `workflow_runs.error` | String | No |  |
| `workflow_runs.elapsed_time` | Number | Yes |  |
| `workflow_runs.total_tokens` | Integer | No |  |
| `workflow_runs.total_steps` | Integer | No |  |
| `workflow_runs.created_by_role` | String | Yes | enum: account, end_user |
| `workflow_runs.created_by` | UUID | Yes |  |
| `workflow_runs.created_at` | DateTime | Yes |  |
| `workflow_runs.finished_at` | DateTime | No |  |
| `workflow_runs.exceptions_count` | Integer | No |  |

### `workflow_schedule_plans`

ORM class `WorkflowSchedulePlan` [D: api/models/trigger.py:484]. Primary key: `id`.

Unique: (`app_id`, `node_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_schedule_plans.id` | UUID | Yes | primary key |
| `workflow_schedule_plans.app_id` | UUID | Yes |  |
| `workflow_schedule_plans.node_id` | String | Yes |  |
| `workflow_schedule_plans.tenant_id` | UUID | Yes |  |
| `workflow_schedule_plans.cron_expression` | String | Yes |  |
| `workflow_schedule_plans.timezone` | String | Yes |  |
| `workflow_schedule_plans.next_run_at` | DateTime | No |  |
| `workflow_schedule_plans.created_at` | DateTime | Yes |  |
| `workflow_schedule_plans.updated_at` | DateTime | Yes |  |

### `workflow_trigger_logs`

ORM class `WorkflowTriggerLog` [D: api/models/trigger.py:221]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_trigger_logs.id` | UUID | Yes | primary key |
| `workflow_trigger_logs.tenant_id` | UUID | Yes |  |
| `workflow_trigger_logs.app_id` | UUID | Yes |  |
| `workflow_trigger_logs.workflow_id` | UUID | Yes |  |
| `workflow_trigger_logs.workflow_run_id` | UUID | No |  |
| `workflow_trigger_logs.root_node_id` | String | No |  |
| `workflow_trigger_logs.trigger_metadata` | String | Yes |  |
| `workflow_trigger_logs.trigger_type` | String | Yes | enum: unknown |
| `workflow_trigger_logs.trigger_data` | String | Yes |  |
| `workflow_trigger_logs.inputs` | String | Yes |  |
| `workflow_trigger_logs.outputs` | String | No |  |
| `workflow_trigger_logs.status` | String | Yes | enum: pending, queued, running, succeeded, paused, failed, rate_limited, retrying |
| `workflow_trigger_logs.error` | String | No |  |
| `workflow_trigger_logs.queue_name` | String | Yes |  |
| `workflow_trigger_logs.celery_task_id` | String | No |  |
| `workflow_trigger_logs.created_by_role` | String | Yes | enum: account, end_user |
| `workflow_trigger_logs.created_by` | String | Yes |  |
| `workflow_trigger_logs.retry_count` | Integer | Yes |  |
| `workflow_trigger_logs.elapsed_time` | Number | No |  |
| `workflow_trigger_logs.total_tokens` | Integer | No |  |
| `workflow_trigger_logs.created_at` | DateTime | Yes |  |
| `workflow_trigger_logs.triggered_at` | DateTime | No |  |
| `workflow_trigger_logs.finished_at` | DateTime | No |  |

### `workflow_version_counters`

ORM class `WorkflowVersionCounter` [D: api/models/workflow.py:749]. Primary key: `app_id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_version_counters.app_id` | UUID | Yes | primary key |
| `workflow_version_counters.last_version_number` | Integer | Yes |  |

### `workflow_webhook_triggers`

ORM class `WorkflowWebhookTrigger` [D: api/models/trigger.py:332]. Primary key: `id`.

Unique: (`app_id`, `node_id`); (`webhook_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflow_webhook_triggers.id` | UUID | Yes | primary key |
| `workflow_webhook_triggers.app_id` | UUID | Yes |  |
| `workflow_webhook_triggers.node_id` | String | Yes |  |
| `workflow_webhook_triggers.tenant_id` | UUID | Yes |  |
| `workflow_webhook_triggers.webhook_id` | String | Yes |  |
| `workflow_webhook_triggers.created_by` | UUID | Yes |  |
| `workflow_webhook_triggers.created_at` | DateTime | Yes |  |
| `workflow_webhook_triggers.updated_at` | DateTime | Yes |  |

### `workflows`

ORM class `Workflow` [D: api/models/workflow.py:177]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `workflows.id` | UUID | Yes | primary key |
| `workflows.tenant_id` | UUID | Yes |  |
| `workflows.app_id` | UUID | Yes |  |
| `workflows.type` | String | Yes | enum: workflow, chat, rag-pipeline, snippet |
| `workflows.kind` | String | No | enum: standard, snippet |
| `workflows.version` | String | Yes |  |
| `workflows.version_number` | Integer | No |  |
| `workflows.marked_name` | String | No |  |
| `workflows.marked_comment` | String | No |  |
| `workflows.graph` | String | Yes |  |
| `workflows._features` | String | Yes |  |
| `workflows.created_by` | UUID | Yes |  |
| `workflows.created_at` | DateTime | Yes |  |
| `workflows.updated_by` | UUID | No |  |
| `workflows.updated_at` | DateTime | Yes |  |
| `workflows._environment_variables` | String | Yes |  |
| `workflows._conversation_variables` | String | Yes |  |
| `workflows._rag_pipeline_variables` | String | Yes |  |

## New and changed entities

This is an as-built record: every entity above already exists in the running schema. Registry rows are in `data-master-erd.md`.

OPEN: which release introduced each entity? Recoverable only from migration filenames, and that dates the migration rather than the feature.

## Migrations

Schema changes for these tables are Alembic revisions in `api/migrations/versions/`, applied in revision order [D: api/migrations/versions/].

OPEN: are the `downgrade()` functions in those revisions exercised anywhere? CI runs a migration job [D: .github/workflows/db-migration-test.yml] but nothing states that it tests the reverse direction.

## Traceability

Domain rules in `ddd/`; stories in `PRDs/prd_v1.17_F-002-*.md`.

OPEN: no column in this repository carries a comment naming the requirement it exists for, so no field-level traceability is recoverable.
