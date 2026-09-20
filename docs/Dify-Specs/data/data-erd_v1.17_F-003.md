---
title: Data Model v1.17 F-003 — Knowledge and RAG
id: F-003
status: draft
owner: TBD
updated: 2026-09-20
---

# Data Model v1.17 F-003 — Knowledge and RAG

> The slice of the data model this feature owns, at field precision. Generated from the ORM.

## Scope

31 entities, 342 columns [D: api/models/].

| Entity | Own / read / write | Source |
| --- | --- | --- |
| `app_dataset_joins` | own | `api/models/dataset.py:976` |
| `child_chunks` | own | `api/models/dataset.py:919` |
| `data_source_api_key_auth_bindings` | own | `api/models/source.py:53` |
| `data_source_oauth_bindings` | own | `api/models/source.py:14` |
| `dataset_api_token_bindings` | own | `api/models/model.py:2295` |
| `dataset_auto_disable_logs` | own | `api/models/dataset.py:1325` |
| `dataset_collection_bindings` | own | `api/models/dataset.py:1145` |
| `dataset_keyword_tables` | own | `api/models/dataset.py:1058` |
| `dataset_metadata_bindings` | own | `api/models/dataset.py:1394` |
| `dataset_metadatas` | own | `api/models/dataset.py:1365` |
| `dataset_permissions` | own | `api/models/dataset.py:1221` |
| `dataset_process_rules` | own | `api/models/dataset.py:394` |
| `dataset_queries` | own | `api/models/dataset.py:1001` |
| `dataset_retriever_resources` | own | `api/models/model.py:2576` |
| `datasets` | own | `api/models/dataset.py:105` |
| `datasource_oauth_params` | own | `api/models/oauth.py:15` |
| `datasource_oauth_tenant_params` | own | `api/models/oauth.py:69` |
| `datasource_providers` | own | `api/models/oauth.py:30` |
| `document_pipeline_execution_logs` | own | `api/models/dataset.py:1517` |
| `document_segment_summaries` | own | `api/models/dataset.py:1589` |
| `document_segments` | own | `api/models/dataset.py:721` |
| `documents` | own | `api/models/dataset.py:438` |
| `embeddings` | own | `api/models/dataset.py:1113` |
| `external_knowledge_apis` | own | `api/models/dataset.py:1246` |
| `external_knowledge_bindings` | own | `api/models/dataset.py:1294` |
| `pipeline_built_in_templates` | own | `api/models/dataset.py:1417` |
| `pipeline_customized_templates` | own | `api/models/dataset.py:1446` |
| `pipeline_recommended_plugins` | own | `api/models/dataset.py:1539` |
| `pipelines` | own | `api/models/dataset.py:1485` |
| `segment_attachment_bindings` | own | `api/models/dataset.py:1563` |
| `tidb_auth_bindings` | own | `api/models/dataset.py:1170` |

I: every entity above is owned rather than merely read by this feature — basis: its ORM class is defined in the model module this feature's controllers write through, and no other feature's controllers construct it [D: api/models/].

OPEN: which of these entities are also written by background jobs under `api/tasks/` outside this feature's request path? Ownership at the table level does not settle who writes at runtime.

## Feature ERD

`schema/erd_v1.17_F-003.puml` draws these entities.

## Field definitions

The readable rendering of `schema/schemas.json` `$defs`, which is the single definition of each shape.

### `app_dataset_joins`

ORM class `AppDatasetJoin` [D: api/models/dataset.py:976]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `app_dataset_joins.id` | UUID | Yes | primary key |
| `app_dataset_joins.app_id` | UUID | Yes |  |
| `app_dataset_joins.dataset_id` | UUID | Yes |  |
| `app_dataset_joins.created_at` | DateTime | Yes |  |

### `child_chunks`

ORM class `ChildChunk` [D: api/models/dataset.py:919]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `child_chunks.id` | UUID | Yes | primary key |
| `child_chunks.tenant_id` | UUID | Yes |  |
| `child_chunks.dataset_id` | UUID | Yes |  |
| `child_chunks.document_id` | UUID | Yes |  |
| `child_chunks.segment_id` | UUID | Yes |  |
| `child_chunks.position` | Integer | Yes |  |
| `child_chunks.content` | String | Yes |  |
| `child_chunks.word_count` | Integer | Yes |  |
| `child_chunks.created_by` | UUID | Yes |  |
| `child_chunks.created_at` | DateTime | Yes |  |
| `child_chunks.updated_by` | UUID | No |  |
| `child_chunks.updated_at` | DateTime | Yes |  |
| `child_chunks.indexing_at` | DateTime | No |  |
| `child_chunks.completed_at` | DateTime | No |  |
| `child_chunks.index_node_id` | String | No |  |
| `child_chunks.index_node_hash` | String | No |  |
| `child_chunks.type` | String | Yes |  |
| `child_chunks.error` | String | No |  |

### `data_source_api_key_auth_bindings`

ORM class `DataSourceApiKeyAuthBinding` [D: api/models/source.py:53]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `data_source_api_key_auth_bindings.id` | UUID | Yes | primary key |
| `data_source_api_key_auth_bindings.tenant_id` | UUID | Yes |  |
| `data_source_api_key_auth_bindings.category` | String | Yes |  |
| `data_source_api_key_auth_bindings.provider` | String | Yes |  |
| `data_source_api_key_auth_bindings.credentials` | String | No |  |
| `data_source_api_key_auth_bindings.created_at` | DateTime | Yes |  |
| `data_source_api_key_auth_bindings.updated_at` | DateTime | Yes |  |
| `data_source_api_key_auth_bindings.disabled` | Boolean | No |  |

### `data_source_oauth_bindings`

ORM class `DataSourceOauthBinding` [D: api/models/source.py:14]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `data_source_oauth_bindings.id` | UUID | Yes | primary key |
| `data_source_oauth_bindings.tenant_id` | UUID | Yes |  |
| `data_source_oauth_bindings.access_token` | String | Yes |  |
| `data_source_oauth_bindings.provider` | String | Yes |  |
| `data_source_oauth_bindings.source_info` | Object | Yes |  |
| `data_source_oauth_bindings.created_at` | DateTime | Yes |  |
| `data_source_oauth_bindings.updated_at` | DateTime | Yes |  |
| `data_source_oauth_bindings.disabled` | Boolean | No |  |

### `dataset_api_token_bindings`

ORM class `DatasetApiTokenBinding` [D: api/models/model.py:2295]. Primary key: `id`.

Unique: (`api_token_id`, `dataset_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dataset_api_token_bindings.id` | UUID | Yes | primary key |
| `dataset_api_token_bindings.api_token_id` | UUID | Yes | FK -> api_tokens.id |
| `dataset_api_token_bindings.dataset_id` | UUID | Yes | FK -> datasets.id |
| `dataset_api_token_bindings.created_at` | DateTime | Yes |  |

### `dataset_auto_disable_logs`

ORM class `DatasetAutoDisableLog` [D: api/models/dataset.py:1325]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dataset_auto_disable_logs.id` | UUID | Yes | primary key |
| `dataset_auto_disable_logs.tenant_id` | UUID | Yes |  |
| `dataset_auto_disable_logs.dataset_id` | UUID | Yes |  |
| `dataset_auto_disable_logs.document_id` | UUID | Yes |  |
| `dataset_auto_disable_logs.notified` | Boolean | Yes |  |
| `dataset_auto_disable_logs.created_at` | DateTime | Yes |  |

### `dataset_collection_bindings`

ORM class `DatasetCollectionBinding` [D: api/models/dataset.py:1145]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dataset_collection_bindings.id` | UUID | Yes | primary key |
| `dataset_collection_bindings.provider_name` | String | Yes |  |
| `dataset_collection_bindings.model_name` | String | Yes |  |
| `dataset_collection_bindings.type` | String | Yes |  |
| `dataset_collection_bindings.collection_name` | String | Yes |  |
| `dataset_collection_bindings.created_at` | DateTime | Yes |  |

### `dataset_keyword_tables`

ORM class `DatasetKeywordTable` [D: api/models/dataset.py:1058]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dataset_keyword_tables.id` | UUID | Yes | primary key |
| `dataset_keyword_tables.dataset_id` | UUID | Yes |  |
| `dataset_keyword_tables.keyword_table` | String | Yes |  |
| `dataset_keyword_tables.data_source_type` | String | Yes |  |

### `dataset_metadata_bindings`

ORM class `DatasetMetadataBinding` [D: api/models/dataset.py:1394]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dataset_metadata_bindings.id` | UUID | Yes | primary key |
| `dataset_metadata_bindings.tenant_id` | UUID | Yes |  |
| `dataset_metadata_bindings.dataset_id` | UUID | Yes |  |
| `dataset_metadata_bindings.metadata_id` | UUID | Yes |  |
| `dataset_metadata_bindings.document_id` | UUID | Yes |  |
| `dataset_metadata_bindings.created_at` | DateTime | Yes |  |
| `dataset_metadata_bindings.created_by` | UUID | Yes |  |

### `dataset_metadatas`

ORM class `DatasetMetadata` [D: api/models/dataset.py:1365]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dataset_metadatas.id` | UUID | Yes | primary key |
| `dataset_metadatas.tenant_id` | UUID | Yes |  |
| `dataset_metadatas.dataset_id` | UUID | Yes |  |
| `dataset_metadatas.type` | String | Yes |  |
| `dataset_metadatas.name` | String | Yes |  |
| `dataset_metadatas.created_at` | DateTime | Yes |  |
| `dataset_metadatas.updated_at` | DateTime | Yes |  |
| `dataset_metadatas.created_by` | UUID | Yes |  |
| `dataset_metadatas.updated_by` | UUID | No |  |

### `dataset_permissions`

ORM class `DatasetPermission` [D: api/models/dataset.py:1221]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dataset_permissions.id` | UUID | Yes | primary key |
| `dataset_permissions.dataset_id` | UUID | Yes |  |
| `dataset_permissions.account_id` | UUID | Yes |  |
| `dataset_permissions.tenant_id` | UUID | Yes |  |
| `dataset_permissions.has_permission` | Boolean | Yes |  |
| `dataset_permissions.created_at` | DateTime | Yes |  |

### `dataset_process_rules`

ORM class `DatasetProcessRule` [D: api/models/dataset.py:394]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dataset_process_rules.id` | UUID | Yes | primary key |
| `dataset_process_rules.dataset_id` | UUID | Yes |  |
| `dataset_process_rules.mode` | String | Yes |  |
| `dataset_process_rules.rules` | String | No |  |
| `dataset_process_rules.created_by` | UUID | Yes |  |
| `dataset_process_rules.created_at` | DateTime | Yes |  |

### `dataset_queries`

ORM class `DatasetQuery` [D: api/models/dataset.py:1001]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dataset_queries.id` | UUID | Yes | primary key |
| `dataset_queries.dataset_id` | UUID | Yes |  |
| `dataset_queries.content` | String | Yes |  |
| `dataset_queries.source` | String | Yes |  |
| `dataset_queries.source_app_id` | UUID | No |  |
| `dataset_queries.created_by_role` | String | Yes |  |
| `dataset_queries.created_by` | UUID | Yes |  |
| `dataset_queries.created_at` | DateTime | Yes |  |

### `dataset_retriever_resources`

ORM class `DatasetRetrieverResource` [D: api/models/model.py:2576]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dataset_retriever_resources.id` | UUID | Yes | primary key |
| `dataset_retriever_resources.message_id` | UUID | Yes |  |
| `dataset_retriever_resources.position` | Integer | Yes |  |
| `dataset_retriever_resources.dataset_id` | UUID | Yes |  |
| `dataset_retriever_resources.dataset_name` | String | Yes |  |
| `dataset_retriever_resources.document_id` | UUID | No |  |
| `dataset_retriever_resources.document_name` | String | Yes |  |
| `dataset_retriever_resources.data_source_type` | String | No |  |
| `dataset_retriever_resources.segment_id` | UUID | No |  |
| `dataset_retriever_resources.score` | Number | No |  |
| `dataset_retriever_resources.content` | String | Yes |  |
| `dataset_retriever_resources.hit_count` | Integer | No |  |
| `dataset_retriever_resources.word_count` | Integer | No |  |
| `dataset_retriever_resources.segment_position` | Integer | No |  |
| `dataset_retriever_resources.index_node_hash` | String | No |  |
| `dataset_retriever_resources.retriever_from` | String | Yes |  |
| `dataset_retriever_resources.created_by` | UUID | Yes |  |
| `dataset_retriever_resources.created_at` | DateTime | Yes |  |

### `datasets`

ORM class `Dataset` [D: api/models/dataset.py:105]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `datasets.id` | UUID | Yes | primary key |
| `datasets.tenant_id` | UUID | Yes |  |
| `datasets.name` | String | Yes |  |
| `datasets.description` | String | No |  |
| `datasets.provider` | String | No |  |
| `datasets.permission` | String | No |  |
| `datasets.data_source_type` | String | Yes |  |
| `datasets.indexing_technique` | String | No |  |
| `datasets.index_struct` | String | No |  |
| `datasets.created_by` | UUID | Yes |  |
| `datasets.maintainer` | UUID | No |  |
| `datasets.created_at` | DateTime | Yes |  |
| `datasets.updated_by` | UUID | No |  |
| `datasets.updated_at` | DateTime | Yes |  |
| `datasets.embedding_model` | String | No |  |
| `datasets.embedding_model_provider` | String | No |  |
| `datasets.keyword_number` | Integer | No |  |
| `datasets.collection_binding_id` | UUID | No |  |
| `datasets.retrieval_model` | Object | No |  |
| `datasets.summary_index_setting` | Object | No |  |
| `datasets.built_in_field_enabled` | Boolean | Yes |  |
| `datasets.icon_info` | Object | No |  |
| `datasets.runtime_mode` | String | No |  |
| `datasets.pipeline_id` | UUID | No |  |
| `datasets.chunk_structure` | String | No |  |
| `datasets.enable_api` | Boolean | Yes |  |
| `datasets.is_multimodal` | Boolean | Yes |  |

### `datasource_oauth_params`

ORM class `DatasourceOauthParamConfig` [D: api/models/oauth.py:15]. Primary key: `id`.

Unique: (`plugin_id`, `provider`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `datasource_oauth_params.id` | UUID | Yes | primary key |
| `datasource_oauth_params.plugin_id` | String | Yes |  |
| `datasource_oauth_params.provider` | String | Yes |  |
| `datasource_oauth_params.system_credentials` | Object | Yes |  |

### `datasource_oauth_tenant_params`

ORM class `DatasourceOauthTenantParamConfig` [D: api/models/oauth.py:69]. Primary key: `id`.

Unique: (`tenant_id`, `plugin_id`, `provider`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `datasource_oauth_tenant_params.id` | UUID | Yes | primary key |
| `datasource_oauth_tenant_params.tenant_id` | UUID | Yes |  |
| `datasource_oauth_tenant_params.provider` | String | Yes |  |
| `datasource_oauth_tenant_params.plugin_id` | String | Yes |  |
| `datasource_oauth_tenant_params.client_params` | Object | Yes |  |
| `datasource_oauth_tenant_params.enabled` | Boolean | Yes |  |
| `datasource_oauth_tenant_params.created_at` | DateTime | Yes |  |
| `datasource_oauth_tenant_params.updated_at` | DateTime | Yes |  |

### `datasource_providers`

ORM class `DatasourceProvider` [D: api/models/oauth.py:30]. Primary key: `id`.

Unique: (`tenant_id`, `plugin_id`, `provider`, `name`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `datasource_providers.id` | UUID | Yes | primary key |
| `datasource_providers.tenant_id` | UUID | Yes |  |
| `datasource_providers.name` | String | Yes |  |
| `datasource_providers.provider` | String | Yes |  |
| `datasource_providers.plugin_id` | String | Yes |  |
| `datasource_providers.auth_type` | String | Yes |  |
| `datasource_providers.encrypted_credentials` | Object | Yes |  |
| `datasource_providers.user_id` | UUID | No |  |
| `datasource_providers.avatar_url` | String | No |  |
| `datasource_providers.is_default` | Boolean | Yes |  |
| `datasource_providers.expires_at` | Integer | Yes |  |
| `datasource_providers.visibility` | String | Yes | enum: only_me, all_team_members, partial_members |
| `datasource_providers.created_at` | DateTime | Yes |  |
| `datasource_providers.updated_at` | DateTime | Yes |  |

### `document_pipeline_execution_logs`

ORM class `DocumentPipelineExecutionLog` [D: api/models/dataset.py:1517]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `document_pipeline_execution_logs.id` | UUID | Yes | primary key |
| `document_pipeline_execution_logs.pipeline_id` | UUID | Yes |  |
| `document_pipeline_execution_logs.document_id` | UUID | Yes |  |
| `document_pipeline_execution_logs.datasource_type` | String | Yes |  |
| `document_pipeline_execution_logs.datasource_info` | String | Yes |  |
| `document_pipeline_execution_logs.datasource_node_id` | String | Yes |  |
| `document_pipeline_execution_logs.input_data` | Object | Yes |  |
| `document_pipeline_execution_logs.created_by` | UUID | No |  |
| `document_pipeline_execution_logs.created_at` | DateTime | Yes |  |

### `document_segment_summaries`

ORM class `DocumentSegmentSummary` [D: api/models/dataset.py:1589]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `document_segment_summaries.id` | UUID | Yes | primary key |
| `document_segment_summaries.dataset_id` | UUID | Yes |  |
| `document_segment_summaries.document_id` | UUID | Yes |  |
| `document_segment_summaries.chunk_id` | UUID | Yes |  |
| `document_segment_summaries.summary_content` | String | No |  |
| `document_segment_summaries.summary_index_node_id` | String | No |  |
| `document_segment_summaries.summary_index_node_hash` | String | No |  |
| `document_segment_summaries.tokens` | Integer | No |  |
| `document_segment_summaries.status` | String | Yes |  |
| `document_segment_summaries.error` | String | No |  |
| `document_segment_summaries.enabled` | Boolean | Yes |  |
| `document_segment_summaries.disabled_at` | DateTime | No |  |
| `document_segment_summaries.disabled_by` | UUID | No |  |
| `document_segment_summaries.created_at` | DateTime | Yes |  |
| `document_segment_summaries.updated_at` | DateTime | Yes |  |

### `document_segments`

ORM class `DocumentSegment` [D: api/models/dataset.py:721]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `document_segments.id` | UUID | Yes | primary key |
| `document_segments.tenant_id` | UUID | Yes |  |
| `document_segments.dataset_id` | UUID | Yes |  |
| `document_segments.document_id` | UUID | Yes |  |
| `document_segments.position` | Integer | Yes |  |
| `document_segments.content` | String | Yes |  |
| `document_segments.word_count` | Integer | Yes |  |
| `document_segments.tokens` | Integer | Yes |  |
| `document_segments.created_by` | UUID | Yes |  |
| `document_segments.index_node_id` | String | No |  |
| `document_segments.index_node_hash` | String | No |  |
| `document_segments.enabled` | Boolean | Yes |  |
| `document_segments.answer` | String | No |  |
| `document_segments.keywords` | Object | No |  |
| `document_segments.disabled_at` | DateTime | No |  |
| `document_segments.disabled_by` | UUID | No |  |
| `document_segments.status` | String | No |  |
| `document_segments.created_at` | DateTime | Yes |  |
| `document_segments.updated_by` | UUID | No |  |
| `document_segments.updated_at` | DateTime | Yes |  |
| `document_segments.indexing_at` | DateTime | No |  |
| `document_segments.completed_at` | DateTime | No |  |
| `document_segments.error` | String | No |  |
| `document_segments.stopped_at` | DateTime | No |  |
| `document_segments.hit_count` | Integer | Yes |  |

### `documents`

ORM class `Document` [D: api/models/dataset.py:438]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `documents.id` | UUID | Yes | primary key |
| `documents.tenant_id` | UUID | Yes |  |
| `documents.dataset_id` | UUID | Yes |  |
| `documents.position` | Integer | Yes |  |
| `documents.data_source_type` | String | Yes |  |
| `documents.data_source_info` | String | No |  |
| `documents.dataset_process_rule_id` | UUID | No |  |
| `documents.batch` | String | Yes |  |
| `documents.name` | String | Yes |  |
| `documents.created_from` | String | Yes |  |
| `documents.created_by` | UUID | Yes |  |
| `documents.created_api_request_id` | UUID | No |  |
| `documents.created_at` | DateTime | Yes |  |
| `documents.processing_started_at` | DateTime | No |  |
| `documents.file_id` | String | No |  |
| `documents.word_count` | Integer | No |  |
| `documents.parsing_completed_at` | DateTime | No |  |
| `documents.cleaning_completed_at` | DateTime | No |  |
| `documents.splitting_completed_at` | DateTime | No |  |
| `documents.tokens` | Integer | No |  |
| `documents.indexing_latency` | Number | No |  |
| `documents.completed_at` | DateTime | No |  |
| `documents.is_paused` | Boolean | No |  |
| `documents.paused_by` | UUID | No |  |
| `documents.paused_at` | DateTime | No |  |
| `documents.error` | String | No |  |
| `documents.stopped_at` | DateTime | No |  |
| `documents.indexing_status` | String | Yes |  |
| `documents.enabled` | Boolean | Yes |  |
| `documents.disabled_at` | DateTime | No |  |
| `documents.disabled_by` | UUID | No |  |
| `documents.archived` | Boolean | Yes |  |
| `documents.archived_reason` | String | No |  |
| `documents.archived_by` | UUID | No |  |
| `documents.archived_at` | DateTime | No |  |
| `documents.updated_at` | DateTime | Yes |  |
| `documents.doc_type` | String | No |  |
| `documents.doc_metadata` | Object | No |  |
| `documents.doc_form` | String | Yes |  |
| `documents.doc_language` | String | No |  |
| `documents.need_summary` | Boolean | Yes |  |

### `embeddings`

ORM class `Embedding` [D: api/models/dataset.py:1113]. Primary key: `id`.

Unique: (`model_name`, `hash`, `provider_name`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `embeddings.id` | UUID | Yes | primary key |
| `embeddings.model_name` | String | Yes |  |
| `embeddings.hash` | String | Yes |  |
| `embeddings.embedding` | String | Yes | column type BinaryData |
| `embeddings.created_at` | DateTime | Yes |  |
| `embeddings.provider_name` | String | Yes |  |

### `external_knowledge_apis`

ORM class `ExternalKnowledgeApis` [D: api/models/dataset.py:1246]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `external_knowledge_apis.id` | UUID | Yes | primary key |
| `external_knowledge_apis.name` | String | Yes |  |
| `external_knowledge_apis.description` | String | Yes |  |
| `external_knowledge_apis.tenant_id` | UUID | Yes |  |
| `external_knowledge_apis.settings` | String | No |  |
| `external_knowledge_apis.created_by` | UUID | Yes |  |
| `external_knowledge_apis.created_at` | DateTime | Yes |  |
| `external_knowledge_apis.updated_by` | UUID | No |  |
| `external_knowledge_apis.updated_at` | DateTime | Yes |  |

### `external_knowledge_bindings`

ORM class `ExternalKnowledgeBindings` [D: api/models/dataset.py:1294]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `external_knowledge_bindings.id` | UUID | Yes | primary key |
| `external_knowledge_bindings.tenant_id` | UUID | Yes |  |
| `external_knowledge_bindings.external_knowledge_api_id` | UUID | Yes |  |
| `external_knowledge_bindings.dataset_id` | UUID | Yes |  |
| `external_knowledge_bindings.external_knowledge_id` | String | Yes |  |
| `external_knowledge_bindings.created_by` | UUID | Yes |  |
| `external_knowledge_bindings.created_at` | DateTime | Yes |  |
| `external_knowledge_bindings.updated_by` | UUID | No |  |
| `external_knowledge_bindings.updated_at` | DateTime | Yes |  |

### `pipeline_built_in_templates`

ORM class `PipelineBuiltInTemplate` [D: api/models/dataset.py:1417]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `pipeline_built_in_templates.id` | UUID | Yes | primary key |
| `pipeline_built_in_templates.name` | String | Yes |  |
| `pipeline_built_in_templates.description` | String | Yes |  |
| `pipeline_built_in_templates.chunk_structure` | String | Yes |  |
| `pipeline_built_in_templates.icon` | Object | Yes |  |
| `pipeline_built_in_templates.yaml_content` | String | Yes |  |
| `pipeline_built_in_templates.copyright` | String | Yes |  |
| `pipeline_built_in_templates.privacy_policy` | String | Yes |  |
| `pipeline_built_in_templates.position` | Integer | Yes |  |
| `pipeline_built_in_templates.install_count` | Integer | Yes |  |
| `pipeline_built_in_templates.language` | String | Yes |  |
| `pipeline_built_in_templates.created_at` | DateTime | Yes |  |
| `pipeline_built_in_templates.updated_at` | DateTime | Yes |  |

### `pipeline_customized_templates`

ORM class `PipelineCustomizedTemplate` [D: api/models/dataset.py:1446]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `pipeline_customized_templates.id` | UUID | Yes | primary key |
| `pipeline_customized_templates.tenant_id` | UUID | Yes |  |
| `pipeline_customized_templates.name` | String | Yes |  |
| `pipeline_customized_templates.description` | String | Yes |  |
| `pipeline_customized_templates.chunk_structure` | String | Yes |  |
| `pipeline_customized_templates.icon` | Object | Yes |  |
| `pipeline_customized_templates.position` | Integer | Yes |  |
| `pipeline_customized_templates.yaml_content` | String | Yes |  |
| `pipeline_customized_templates.install_count` | Integer | Yes |  |
| `pipeline_customized_templates.language` | String | Yes |  |
| `pipeline_customized_templates.created_by` | UUID | Yes |  |
| `pipeline_customized_templates.updated_by` | UUID | No |  |
| `pipeline_customized_templates.created_at` | DateTime | Yes |  |
| `pipeline_customized_templates.updated_at` | DateTime | Yes |  |

### `pipeline_recommended_plugins`

ORM class `PipelineRecommendedPlugin` [D: api/models/dataset.py:1539]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `pipeline_recommended_plugins.id` | UUID | Yes | primary key |
| `pipeline_recommended_plugins.plugin_id` | String | Yes |  |
| `pipeline_recommended_plugins.provider_name` | String | Yes |  |
| `pipeline_recommended_plugins.type` | String | Yes |  |
| `pipeline_recommended_plugins.position` | Integer | Yes |  |
| `pipeline_recommended_plugins.active` | Boolean | Yes |  |
| `pipeline_recommended_plugins.created_at` | DateTime | Yes |  |
| `pipeline_recommended_plugins.updated_at` | DateTime | Yes |  |

### `pipelines`

ORM class `Pipeline` [D: api/models/dataset.py:1485]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `pipelines.id` | UUID | Yes | primary key |
| `pipelines.tenant_id` | UUID | Yes |  |
| `pipelines.name` | String | Yes |  |
| `pipelines.description` | String | Yes |  |
| `pipelines.workflow_id` | UUID | No |  |
| `pipelines.is_public` | Boolean | Yes |  |
| `pipelines.is_published` | Boolean | Yes |  |
| `pipelines.created_by` | UUID | No |  |
| `pipelines.created_at` | DateTime | Yes |  |
| `pipelines.updated_by` | UUID | No |  |
| `pipelines.updated_at` | DateTime | Yes |  |

### `segment_attachment_bindings`

ORM class `SegmentAttachmentBinding` [D: api/models/dataset.py:1563]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `segment_attachment_bindings.id` | UUID | Yes | primary key |
| `segment_attachment_bindings.tenant_id` | UUID | Yes |  |
| `segment_attachment_bindings.dataset_id` | UUID | Yes |  |
| `segment_attachment_bindings.document_id` | UUID | Yes |  |
| `segment_attachment_bindings.segment_id` | UUID | Yes |  |
| `segment_attachment_bindings.attachment_id` | UUID | Yes |  |
| `segment_attachment_bindings.created_at` | DateTime | Yes |  |

### `tidb_auth_bindings`

ORM class `TidbAuthBinding` [D: api/models/dataset.py:1170]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tidb_auth_bindings.id` | UUID | Yes | primary key |
| `tidb_auth_bindings.tenant_id` | UUID | No |  |
| `tidb_auth_bindings.cluster_id` | String | Yes |  |
| `tidb_auth_bindings.cluster_name` | String | Yes |  |
| `tidb_auth_bindings.active` | Boolean | Yes |  |
| `tidb_auth_bindings.status` | String | Yes |  |
| `tidb_auth_bindings.account` | String | Yes |  |
| `tidb_auth_bindings.password` | String | Yes |  |
| `tidb_auth_bindings.qdrant_endpoint` | String | No |  |
| `tidb_auth_bindings.created_at` | DateTime | Yes |  |

## New and changed entities

This is an as-built record: every entity above already exists in the running schema. Registry rows are in `data-master-erd.md`.

OPEN: which release introduced each entity? Recoverable only from migration filenames, and that dates the migration rather than the feature.

## Migrations

Schema changes for these tables are Alembic revisions in `api/migrations/versions/`, applied in revision order [D: api/migrations/versions/].

OPEN: are the `downgrade()` functions in those revisions exercised anywhere? CI runs a migration job [D: .github/workflows/db-migration-test.yml] but nothing states that it tests the reverse direction.

## Traceability

Domain rules in `ddd/`; stories in `PRDs/prd_v1.17_F-003-*.md`.

OPEN: no column in this repository carries a comment naming the requirement it exists for, so no field-level traceability is recoverable.
