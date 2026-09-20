---
title: Data Model v1.17 F-001 — App Studio and Publishing
id: F-001
status: draft
owner: TBD
updated: 2026-09-20
---

# Data Model v1.17 F-001 — App Studio and Publishing

> The slice of the data model this feature owns, at field precision. Generated from the ORM.

## Scope

26 entities, 329 columns [D: api/models/].

| Entity | Own / read / write | Source |
| --- | --- | --- |
| `account_trial_app_records` | own | `api/models/model.py:1026` |
| `api_requests` | own | `api/models/model.py:2414` |
| `app_annotation_hit_histories` | own | `api/models/model.py:1959` |
| `app_annotation_settings` | own | `api/models/model.py:1996` |
| `app_mcp_servers` | own | `api/models/model.py:2122` |
| `app_model_configs` | own | `api/models/model.py:717` |
| `app_stars` | own | `api/models/model.py:695` |
| `apps` | own | `api/models/model.py:407` |
| `conversations` | own | `api/models/model.py:1109` |
| `dify_setups` | own | `api/models/model.py:361` |
| `exporle_banners` | own | `api/models/model.py:1051` |
| `message_agent_thoughts` | own | `api/models/model.py:2454` |
| `message_annotations` | own | `api/models/model.py:1914` |
| `message_chains` | own | `api/models/model.py:2435` |
| `message_feedbacks` | own | `api/models/model.py:1836` |
| `message_files` | own | `api/models/model.py:1886` |
| `messages` | own | `api/models/model.py:1442` |
| `operation_logs` | own | `api/models/model.py:2054` |
| `recommended_apps` | own | `api/models/model.py:926` |
| `sites` | own | `api/models/model.py:2169` |
| `tag_bindings` | own | `api/models/model.py:2629` |
| `tags` | own | `api/models/model.py:2607` |
| `tenant_credit_pools` | own | `api/models/model.py:2694` |
| `trace_app_config` | own | `api/models/model.py:2649` |
| `trial_apps` | own | `api/models/model.py:1003` |
| `upload_files` | own | `api/models/model.py:2324` |

I: every entity above is owned rather than merely read by this feature — basis: its ORM class is defined in the model module this feature's controllers write through, and no other feature's controllers construct it [D: api/models/].

OPEN: which of these entities are also written by background jobs under `api/tasks/` outside this feature's request path? Ownership at the table level does not settle who writes at runtime.

## Feature ERD

`schema/erd_v1.17_F-001.puml` draws these entities.

## Field definitions

The readable rendering of `schema/schemas.json` `$defs`, which is the single definition of each shape.

### `account_trial_app_records`

ORM class `AccountTrialAppRecord` [D: api/models/model.py:1026]. Primary key: `id`.

Unique: (`account_id`, `app_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `account_trial_app_records.id` | UUID | Yes | primary key |
| `account_trial_app_records.account_id` | UUID | Yes |  |
| `account_trial_app_records.app_id` | UUID | Yes |  |
| `account_trial_app_records.count` | Integer | Yes |  |
| `account_trial_app_records.created_at` | DateTime | Yes |  |

### `api_requests`

ORM class `ApiRequest` [D: api/models/model.py:2414]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `api_requests.id` | UUID | Yes | primary key |
| `api_requests.tenant_id` | UUID | Yes |  |
| `api_requests.api_token_id` | UUID | Yes |  |
| `api_requests.path` | String | Yes |  |
| `api_requests.request` | String | No |  |
| `api_requests.response` | String | No |  |
| `api_requests.ip` | String | Yes |  |
| `api_requests.created_at` | DateTime | Yes |  |

### `app_annotation_hit_histories`

ORM class `AppAnnotationHitHistory` [D: api/models/model.py:1959]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `app_annotation_hit_histories.id` | UUID | Yes | primary key |
| `app_annotation_hit_histories.app_id` | UUID | Yes |  |
| `app_annotation_hit_histories.annotation_id` | UUID | Yes |  |
| `app_annotation_hit_histories.source` | String | Yes |  |
| `app_annotation_hit_histories.question` | String | Yes |  |
| `app_annotation_hit_histories.account_id` | UUID | Yes |  |
| `app_annotation_hit_histories.created_at` | DateTime | Yes |  |
| `app_annotation_hit_histories.score` | Number | Yes |  |
| `app_annotation_hit_histories.message_id` | UUID | Yes |  |
| `app_annotation_hit_histories.annotation_question` | String | Yes |  |
| `app_annotation_hit_histories.annotation_content` | String | Yes |  |

### `app_annotation_settings`

ORM class `AppAnnotationSetting` [D: api/models/model.py:1996]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `app_annotation_settings.id` | UUID | Yes | primary key |
| `app_annotation_settings.app_id` | UUID | Yes |  |
| `app_annotation_settings.score_threshold` | Number | Yes |  |
| `app_annotation_settings.collection_binding_id` | UUID | Yes |  |
| `app_annotation_settings.created_user_id` | UUID | Yes |  |
| `app_annotation_settings.created_at` | DateTime | Yes |  |
| `app_annotation_settings.updated_user_id` | UUID | Yes |  |
| `app_annotation_settings.updated_at` | DateTime | Yes |  |

### `app_mcp_servers`

ORM class `AppMCPServer` [D: api/models/model.py:2122]. Primary key: `id`.

Unique: (`tenant_id`, `app_id`); (`server_code`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `app_mcp_servers.id` | UUID | Yes | primary key |
| `app_mcp_servers.tenant_id` | UUID | Yes |  |
| `app_mcp_servers.app_id` | UUID | Yes |  |
| `app_mcp_servers.name` | String | Yes |  |
| `app_mcp_servers.description` | String | Yes |  |
| `app_mcp_servers.server_code` | String | Yes |  |
| `app_mcp_servers.status` | String | Yes | enum: normal, active, inactive |
| `app_mcp_servers.parameters` | String | Yes |  |
| `app_mcp_servers.created_at` | DateTime | Yes |  |
| `app_mcp_servers.updated_at` | DateTime | Yes |  |

### `app_model_configs`

ORM class `AppModelConfig` [D: api/models/model.py:717]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `app_model_configs.id` | UUID | Yes | primary key |
| `app_model_configs.app_id` | UUID | Yes |  |
| `app_model_configs.provider` | String | No |  |
| `app_model_configs.model_id` | String | No |  |
| `app_model_configs.configs` | Object | No |  |
| `app_model_configs.created_by` | UUID | No |  |
| `app_model_configs.created_at` | DateTime | Yes |  |
| `app_model_configs.updated_by` | UUID | No |  |
| `app_model_configs.updated_at` | DateTime | Yes |  |
| `app_model_configs.opening_statement` | String | No |  |
| `app_model_configs.suggested_questions` | String | No |  |
| `app_model_configs.suggested_questions_after_answer` | String | No |  |
| `app_model_configs.speech_to_text` | String | No |  |
| `app_model_configs.text_to_speech` | String | No |  |
| `app_model_configs.more_like_this` | String | No |  |
| `app_model_configs.model` | String | No |  |
| `app_model_configs.user_input_form` | String | No |  |
| `app_model_configs.dataset_query_variable` | String | No |  |
| `app_model_configs.pre_prompt` | String | No |  |
| `app_model_configs.agent_mode` | String | No |  |
| `app_model_configs.sensitive_word_avoidance` | String | No |  |
| `app_model_configs.retriever_resource` | String | No |  |
| `app_model_configs.prompt_type` | String | Yes | enum: simple, advanced |
| `app_model_configs.chat_prompt_config` | String | No |  |
| `app_model_configs.completion_prompt_config` | String | No |  |
| `app_model_configs.dataset_configs` | String | No |  |
| `app_model_configs.external_data_tools` | String | No |  |
| `app_model_configs.file_upload` | String | No |  |

### `app_stars`

ORM class `AppStar` [D: api/models/model.py:695]. Primary key: `id`.

Unique: (`tenant_id`, `account_id`, `app_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `app_stars.id` | UUID | Yes | primary key |
| `app_stars.tenant_id` | UUID | Yes |  |
| `app_stars.app_id` | UUID | Yes |  |
| `app_stars.account_id` | UUID | Yes |  |
| `app_stars.created_at` | DateTime | Yes |  |

### `apps`

ORM class `App` [D: api/models/model.py:407]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `apps.id` | UUID | Yes | primary key |
| `apps.tenant_id` | UUID | Yes |  |
| `apps.name` | String | Yes |  |
| `apps.description` | String | No |  |
| `apps.mode` | String | Yes | enum: completion, workflow, chat, advanced-chat, agent-chat, agent, channel, rag-pipeline |
| `apps.icon_type` | String | No |  |
| `apps.icon` | String | Yes |  |
| `apps.icon_background` | String | No |  |
| `apps.app_model_config_id` | UUID | No |  |
| `apps.workflow_id` | UUID | No |  |
| `apps.status` | String | No | enum: normal |
| `apps.enable_site` | Boolean | Yes |  |
| `apps.enable_api` | Boolean | Yes |  |
| `apps.api_rpm` | Integer | No |  |
| `apps.api_rph` | Integer | No |  |
| `apps.is_demo` | Boolean | No |  |
| `apps.is_public` | Boolean | No |  |
| `apps.is_universal` | Boolean | No |  |
| `apps.tracing` | String | No |  |
| `apps.created_by` | UUID | No |  |
| `apps.maintainer` | UUID | No |  |
| `apps.created_at` | DateTime | Yes |  |
| `apps.updated_by` | UUID | No |  |
| `apps.updated_at` | DateTime | Yes |  |
| `apps.use_icon_as_answer_icon` | Boolean | Yes |  |

### `conversations`

ORM class `Conversation` [D: api/models/model.py:1109]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `conversations.id` | UUID | Yes | primary key |
| `conversations.app_id` | UUID | Yes |  |
| `conversations.app_model_config_id` | UUID | No |  |
| `conversations.agent_workspace_binding_id` | UUID | No |  |
| `conversations.model_provider` | String | No |  |
| `conversations.override_model_configs` | String | Yes |  |
| `conversations.model_id` | String | No |  |
| `conversations.mode` | String | Yes | enum: completion, workflow, chat, advanced-chat, agent-chat, agent, channel, rag-pipeline |
| `conversations.name` | String | Yes |  |
| `conversations.summary` | String | Yes |  |
| `conversations._inputs` | Object | Yes |  |
| `conversations.introduction` | String | No |  |
| `conversations.system_instruction` | String | No |  |
| `conversations.system_instruction_tokens` | Integer | Yes |  |
| `conversations.status` | String | Yes | enum: normal |
| `conversations.invoke_from` | String | No | enum: service-api, web-app, trigger, explore, debugger, published, validation, openapi |
| `conversations.from_source` | String | Yes | enum: api, console |
| `conversations.from_end_user_id` | UUID | Yes |  |
| `conversations.from_account_id` | UUID | Yes |  |
| `conversations.read_at` | DateTime | Yes |  |
| `conversations.read_account_id` | UUID | Yes |  |
| `conversations.dialogue_count` | String | No |  |
| `conversations.created_at` | DateTime | Yes |  |
| `conversations.updated_at` | DateTime | Yes |  |
| `conversations.is_deleted` | Boolean | Yes |  |

### `dify_setups`

ORM class `DifySetup` [D: api/models/model.py:361]. Primary key: `version`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dify_setups.version` | String | Yes | primary key |
| `dify_setups.instance_id` | String | No |  |
| `dify_setups.install_reported_at` | DateTime | No |  |
| `dify_setups.last_heartbeat_at` | DateTime | No |  |
| `dify_setups.setup_at` | DateTime | Yes |  |

### `exporle_banners`

ORM class `ExporleBanner` [D: api/models/model.py:1051]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `exporle_banners.id` | UUID | Yes | primary key |
| `exporle_banners.content` | Object | Yes |  |
| `exporle_banners.link` | String | Yes |  |
| `exporle_banners.sort` | Integer | Yes |  |
| `exporle_banners.status` | String | Yes | enum: enabled, disabled |
| `exporle_banners.created_at` | DateTime | Yes |  |
| `exporle_banners.language` | String | Yes |  |

### `message_agent_thoughts`

ORM class `MessageAgentThought` [D: api/models/model.py:2454]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `message_agent_thoughts.id` | UUID | Yes | primary key |
| `message_agent_thoughts.message_id` | UUID | Yes |  |
| `message_agent_thoughts.position` | Integer | Yes |  |
| `message_agent_thoughts.created_by_role` | String | Yes | enum: account, end_user |
| `message_agent_thoughts.created_by` | UUID | Yes |  |
| `message_agent_thoughts.message_chain_id` | UUID | No |  |
| `message_agent_thoughts.thought` | String | No |  |
| `message_agent_thoughts.tool` | String | No |  |
| `message_agent_thoughts.tool_labels_str` | String | Yes |  |
| `message_agent_thoughts.tool_meta_str` | String | Yes |  |
| `message_agent_thoughts.tool_input` | String | No |  |
| `message_agent_thoughts.observation` | String | No |  |
| `message_agent_thoughts.tool_process_data` | String | No |  |
| `message_agent_thoughts.message` | String | No |  |
| `message_agent_thoughts.message_token` | Integer | No |  |
| `message_agent_thoughts.message_unit_price` | Number | No |  |
| `message_agent_thoughts.message_price_unit` | Number | Yes |  |
| `message_agent_thoughts.message_files` | String | No |  |
| `message_agent_thoughts.answer` | String | No |  |
| `message_agent_thoughts.answer_token` | Integer | No |  |
| `message_agent_thoughts.answer_unit_price` | Number | No |  |
| `message_agent_thoughts.answer_price_unit` | Number | Yes |  |
| `message_agent_thoughts.tokens` | Integer | No |  |
| `message_agent_thoughts.total_price` | Number | No |  |
| `message_agent_thoughts.currency` | String | No |  |
| `message_agent_thoughts.latency` | Number | No |  |
| `message_agent_thoughts.created_at` | DateTime | Yes |  |

### `message_annotations`

ORM class `MessageAnnotation` [D: api/models/model.py:1914]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `message_annotations.id` | UUID | Yes | primary key |
| `message_annotations.app_id` | UUID | Yes |  |
| `message_annotations.question` | String | Yes |  |
| `message_annotations.content` | String | Yes |  |
| `message_annotations.hit_count` | Integer | Yes |  |
| `message_annotations.account_id` | UUID | Yes |  |
| `message_annotations.conversation_id` | UUID | No | FK -> conversations.id |
| `message_annotations.message_id` | UUID | No |  |
| `message_annotations.created_at` | DateTime | Yes |  |
| `message_annotations.updated_at` | DateTime | Yes |  |

### `message_chains`

ORM class `MessageChain` [D: api/models/model.py:2435]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `message_chains.id` | UUID | Yes | primary key |
| `message_chains.message_id` | UUID | Yes |  |
| `message_chains.type` | String | Yes | enum: system |
| `message_chains.input` | String | No |  |
| `message_chains.output` | String | No |  |
| `message_chains.created_at` | DateTime | Yes |  |

### `message_feedbacks`

ORM class `MessageFeedback` [D: api/models/model.py:1836]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `message_feedbacks.id` | UUID | Yes | primary key |
| `message_feedbacks.app_id` | UUID | Yes |  |
| `message_feedbacks.conversation_id` | UUID | Yes |  |
| `message_feedbacks.message_id` | UUID | Yes |  |
| `message_feedbacks.rating` | String | Yes | enum: like, dislike |
| `message_feedbacks.from_source` | String | Yes | enum: user, admin |
| `message_feedbacks.content` | String | No |  |
| `message_feedbacks.from_end_user_id` | UUID | No |  |
| `message_feedbacks.from_account_id` | UUID | No |  |
| `message_feedbacks.created_at` | DateTime | Yes |  |
| `message_feedbacks.updated_at` | DateTime | Yes |  |

### `message_files`

ORM class `MessageFile` [D: api/models/model.py:1886]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `message_files.id` | UUID | Yes | primary key |
| `message_files.message_id` | UUID | Yes |  |
| `message_files.type` | String | Yes |  |
| `message_files.transfer_method` | String | Yes |  |
| `message_files.created_by_role` | String | Yes | enum: account, end_user |
| `message_files.created_by` | UUID | Yes |  |
| `message_files.belongs_to` | String | No | enum: user, assistant |
| `message_files.url` | String | No |  |
| `message_files.upload_file_id` | UUID | No |  |
| `message_files.created_at` | DateTime | Yes |  |

### `messages`

ORM class `Message` [D: api/models/model.py:1442]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `messages.id` | UUID | Yes | primary key |
| `messages.app_id` | UUID | Yes |  |
| `messages.model_provider` | String | No |  |
| `messages.model_id` | String | No |  |
| `messages.override_model_configs` | String | No |  |
| `messages.conversation_id` | UUID | Yes | FK -> conversations.id |
| `messages._inputs` | Object | Yes |  |
| `messages.query` | String | Yes |  |
| `messages.message` | Object | Yes |  |
| `messages.message_tokens` | Integer | Yes |  |
| `messages.message_unit_price` | Number | Yes |  |
| `messages.message_price_unit` | Number | Yes |  |
| `messages.answer` | String | Yes |  |
| `messages.answer_tokens` | Integer | Yes |  |
| `messages.answer_unit_price` | Number | Yes |  |
| `messages.answer_price_unit` | Number | Yes |  |
| `messages.parent_message_id` | UUID | No |  |
| `messages.provider_response_latency` | Number | Yes |  |
| `messages.total_price` | Number | No |  |
| `messages.currency` | String | Yes |  |
| `messages.status` | String | Yes | enum: normal, paused, error |
| `messages.error` | String | No |  |
| `messages.message_metadata` | String | No |  |
| `messages.invoke_from` | String | No | enum: service-api, web-app, trigger, explore, debugger, published, validation, openapi |
| `messages.from_source` | String | Yes | enum: api, console |
| `messages.from_end_user_id` | UUID | No |  |
| `messages.from_account_id` | UUID | No |  |
| `messages.created_at` | DateTime | No |  |
| `messages.updated_at` | DateTime | Yes |  |
| `messages.agent_based` | Boolean | Yes |  |
| `messages.workflow_run_id` | UUID | No |  |
| `messages.app_mode` | String | No | enum: completion, workflow, chat, advanced-chat, agent-chat, agent, channel, rag-pipeline |

### `operation_logs`

ORM class `OperationLog` [D: api/models/model.py:2054]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `operation_logs.id` | UUID | Yes | primary key |
| `operation_logs.tenant_id` | UUID | Yes |  |
| `operation_logs.account_id` | UUID | Yes |  |
| `operation_logs.action` | String | Yes |  |
| `operation_logs.content` | Object | No |  |
| `operation_logs.created_at` | DateTime | Yes |  |
| `operation_logs.created_ip` | String | Yes |  |
| `operation_logs.updated_at` | DateTime | Yes |  |

### `recommended_apps`

ORM class `RecommendedApp` [D: api/models/model.py:926]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `recommended_apps.id` | UUID | Yes | primary key |
| `recommended_apps.app_id` | UUID | Yes |  |
| `recommended_apps.description` | Object | Yes |  |
| `recommended_apps.copyright` | String | Yes |  |
| `recommended_apps.privacy_policy` | String | Yes |  |
| `recommended_apps.category` | String | Yes |  |
| `recommended_apps.categories` | Object | No |  |
| `recommended_apps.custom_disclaimer` | String | No |  |
| `recommended_apps.position` | Integer | Yes |  |
| `recommended_apps.is_listed` | Boolean | Yes |  |
| `recommended_apps.is_learn_dify` | Boolean | Yes |  |
| `recommended_apps.is_cloud_only` | Boolean | Yes |  |
| `recommended_apps.install_count` | Integer | Yes |  |
| `recommended_apps.language` | String | Yes |  |
| `recommended_apps.created_at` | DateTime | Yes |  |
| `recommended_apps.updated_at` | DateTime | Yes |  |

### `sites`

ORM class `Site` [D: api/models/model.py:2169]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `sites.app_id` | UUID | Yes |  |
| `sites.title` | String | Yes |  |
| `sites.default_language` | String | Yes |  |
| `sites.customize_token_strategy` | String | Yes | enum: must, allow, not_allow, uuid |
| `sites.id` | UUID | Yes | primary key |
| `sites.icon_type` | String | No |  |
| `sites.icon` | String | No |  |
| `sites.icon_background` | String | No |  |
| `sites.description` | String | No |  |
| `sites.copyright` | String | No |  |
| `sites.privacy_policy` | String | No |  |
| `sites.input_placeholder` | String | No |  |
| `sites.created_by` | UUID | No |  |
| `sites.updated_by` | UUID | No |  |
| `sites.code` | String | No |  |
| `sites.created_at` | DateTime | Yes |  |
| `sites.updated_at` | DateTime | Yes |  |
| `sites.customize_domain` | String | No |  |
| `sites.chat_color_theme` | String | No |  |
| `sites.prompt_public` | Boolean | Yes |  |
| `sites.chat_color_theme_inverted` | Boolean | Yes |  |
| `sites.show_workflow_steps` | Boolean | Yes |  |
| `sites.use_icon_as_answer_icon` | Boolean | Yes |  |
| `sites.custom_disclaimer` | String | Yes |  |
| `sites.status` | String | Yes | enum: normal |

### `tag_bindings`

ORM class `TagBinding` [D: api/models/model.py:2629]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tag_bindings.id` | UUID | Yes | primary key |
| `tag_bindings.tenant_id` | UUID | No |  |
| `tag_bindings.tag_id` | UUID | No |  |
| `tag_bindings.target_id` | UUID | No |  |
| `tag_bindings.created_by` | UUID | Yes |  |
| `tag_bindings.created_at` | DateTime | Yes |  |

### `tags`

ORM class `Tag` [D: api/models/model.py:2607]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tags.id` | UUID | Yes | primary key |
| `tags.tenant_id` | UUID | No |  |
| `tags.type` | String | Yes | enum: knowledge, app, snippet, skill |
| `tags.name` | String | Yes |  |
| `tags.created_by` | UUID | Yes |  |
| `tags.created_at` | DateTime | Yes |  |

### `tenant_credit_pools`

ORM class `TenantCreditPool` [D: api/models/model.py:2694]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tenant_credit_pools.id` | UUID | Yes | primary key |
| `tenant_credit_pools.tenant_id` | UUID | Yes |  |
| `tenant_credit_pools.pool_type` | String | Yes | enum: paid, free, trial |
| `tenant_credit_pools.quota_limit` | Integer | Yes |  |
| `tenant_credit_pools.quota_used` | Integer | Yes |  |
| `tenant_credit_pools.created_at` | DateTime | Yes |  |
| `tenant_credit_pools.updated_at` | DateTime | Yes |  |

### `trace_app_config`

ORM class `TraceAppConfig` [D: api/models/model.py:2649]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `trace_app_config.id` | UUID | Yes | primary key |
| `trace_app_config.app_id` | UUID | Yes |  |
| `trace_app_config.tracing_provider` | String | No |  |
| `trace_app_config.tracing_config` | Object | No |  |
| `trace_app_config.created_at` | DateTime | Yes |  |
| `trace_app_config.updated_at` | DateTime | Yes |  |
| `trace_app_config.is_active` | Boolean | Yes |  |

### `trial_apps`

ORM class `TrialApp` [D: api/models/model.py:1003]. Primary key: `id`.

Unique: (`app_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `trial_apps.id` | UUID | Yes | primary key |
| `trial_apps.app_id` | UUID | Yes |  |
| `trial_apps.tenant_id` | UUID | Yes |  |
| `trial_apps.created_at` | DateTime | Yes |  |
| `trial_apps.trial_limit` | Integer | Yes |  |

### `upload_files`

ORM class `UploadFile` [D: api/models/model.py:2324]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `upload_files.id` | UUID | Yes | primary key |
| `upload_files.tenant_id` | UUID | Yes |  |
| `upload_files.storage_type` | String | Yes |  |
| `upload_files.key` | String | Yes |  |
| `upload_files.name` | String | Yes |  |
| `upload_files.size` | Integer | Yes |  |
| `upload_files.extension` | String | Yes |  |
| `upload_files.mime_type` | String | No |  |
| `upload_files.created_by` | UUID | Yes |  |
| `upload_files.created_at` | DateTime | Yes |  |
| `upload_files.used` | Boolean | Yes |  |
| `upload_files.created_by_role` | String | Yes | enum: account, end_user |
| `upload_files.used_by` | UUID | No |  |
| `upload_files.used_at` | DateTime | No |  |
| `upload_files.hash` | String | No |  |
| `upload_files.source_url` | String | No |  |

## New and changed entities

This is an as-built record: every entity above already exists in the running schema. Registry rows are in `data-master-erd.md`.

OPEN: which release introduced each entity? Recoverable only from migration filenames, and that dates the migration rather than the feature.

## Migrations

Schema changes for these tables are Alembic revisions in `api/migrations/versions/`, applied in revision order [D: api/migrations/versions/].

OPEN: are the `downgrade()` functions in those revisions exercised anywhere? CI runs a migration job [D: .github/workflows/db-migration-test.yml] but nothing states that it tests the reverse direction.

## Traceability

Domain rules in `ddd/`; stories in `PRDs/prd_v1.17_F-001-*.md`.

OPEN: no column in this repository carries a comment naming the requirement it exists for, so no field-level traceability is recoverable.
