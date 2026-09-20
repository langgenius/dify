---
title: Feature Architecture v1.17 F-003 — Knowledge and RAG
id: F-003
status: draft
owner: TBD
updated: 2026-09-20
---

# Feature Architecture v1.17 F-003 — Knowledge and RAG

> As-built. Read with `architect.md` for system context and `architect_common.md` for the enforced layer rules.

## Design approach

I: a dataset is an indexed corpus assembled by a pipeline and queried at retrieval time, with the vector store pluggable per deployment — basis: `datasets` owns `documents` and `document_segments`, `pipelines` describes the ingestion graph, and 43 separate vector-DB packages implement the same storage interface [D: api/models/dataset.py; api/providers/vdb/].

OPEN: why this shape and not another? The code retains no record of what was rejected, and this section states only what the code does.

## Surface

212 operations over 159 paths, on `console` (161), `service_api` (50), `inner_api` (1) [D: api/controllers/].

Busiest handler modules:

| Module | Operations |
| --- | --- |
| `api/controllers/console/datasets/rag_pipeline/rag_pipeline_workflow.py` | 30 |
| `api/controllers/console/datasets/datasets_document.py` | 24 |
| `api/controllers/console/datasets/datasets.py` | 20 |
| `api/controllers/console/datasets/datasets_segments.py` | 15 |
| `api/controllers/service_api/dataset/document.py` | 15 |
| `api/controllers/service_api/dataset/dataset.py` | 13 |
| `api/controllers/console/datasets/rag_pipeline/datasource_auth.py` | 12 |
| `api/controllers/console/datasets/rag_pipeline/rag_pipeline_draft_variable.py` | 10 |

Full table in `data/api-contract_v1.17_F-003.md`.

## Components and call direction

Controllers in this feature import these application and domain modules [D: api/controllers/]:

| Module | Imported by N handler files |
| --- | --- |
| `services.dataset_service` | 13 |
| `services.entities.knowledge_entities.knowledge_entities` | 7 |
| `services.rag_pipeline.rag_pipeline` | 5 |
| `services.enterprise` | 5 |
| `core.errors.error` | 5 |
| `core.rag.index_processor.constant.index_type` | 5 |
| `services.errors.chunk` | 5 |
| `core.entities.knowledge_entities` | 4 |
| `services.dataset_ref_service` | 4 |
| `services.file_service` | 3 |

The direction is one-way: `controllers -> services -> core -> libs`, enforced by import-linter [D: api/.importlinter:21].

## Stores

31 owned tables; field detail in `data/data-erd_v1.17_F-003.md`:

`app_dataset_joins`, `child_chunks`, `data_source_api_key_auth_bindings`, `data_source_oauth_bindings`, `dataset_api_token_bindings`, `dataset_auto_disable_logs`, `dataset_collection_bindings`, `dataset_keyword_tables`, `dataset_metadata_bindings`, `dataset_metadatas`, `dataset_permissions`, `dataset_process_rules`, `dataset_queries`, `dataset_retriever_resources`, `datasets`, `datasource_oauth_params`, `datasource_oauth_tenant_params`, `datasource_providers`, `document_pipeline_execution_logs`, `document_segment_summaries`, `document_segments`, `documents`, `embeddings`, `external_knowledge_apis`, `external_knowledge_bindings`, `pipeline_built_in_templates`, `pipeline_customized_templates`, `pipeline_recommended_plugins`, `pipelines`, `segment_attachment_bindings`, `tidb_auth_bindings`

## Stated constraints in this feature

10 rule-bearing comments sit in this feature's files. Each is a quote, not a paraphrase; the domain document promotes the ones the code enforces.

- > "Use a lazy proxy so cleanup paths (delete_by_ids / delete / text_exists) never transitively trigger billing API calls during ``Vector(dataset, session=...)`` construction. The real embedding model is materialized only when an ``embed_*`` method is actually invoked (i.e. create / search paths)." [D: api/core/rag/datasource/vdb/vector_factory.py:122]
- > "Top-level request payload for the inner knowledge retrieval endpoint. Request validation enforces the endpoint's behavioral contract: callers must provide at least one dataset ID, at least one of ``query`` or ``attachment_ids``, and a text query for ``single`` retrieval mode." [D: api/services/entities/knowledge_retrieval_inner.py:129]
- > "Generate summary index for specified documents. This endpoint checks if the dataset configuration supports summary generation (indexing_technique must be 'high_quality' and summary_index_setting.enable must be true), then asynchronously generates summary indexes for the provided documents." [D: api/controllers/console/datasets/datasets_document.py:1673]
- > "Use a plain Session so that caught exceptions inside the service (which return FAILED status instead of re-raising) do not leave the transaction in a closed state that a .begin() context manager cannot handle. See app_import.py for the canonical pattern." [D: api/controllers/console/datasets/rag_pipeline/rag_pipeline_import.py:90]
- > "Reuse the caller-bound model instance for both schema resolution and downstream planner/invoke calls so a single request never mixes tenant-scope and request-bound runtimes." [D: api/core/rag/retrieval/dataset_retrieval.py:436]
- > "Reserve the whole retry batch before changing any document state. Redis lock acquisition is intentionally coupled to this bounded status transaction so a concurrent request cannot partially admit the batch." [D: api/services/dataset_service.py:2157]
- > "Without an account we cannot resolve RBAC resource visibility." [D: api/services/dataset_service.py:328]
- > "Authorize and forward the explicitly enabled KnowledgeFS Console operations. The dedicated request path uses Dify's shared SSRF policy, never follows redirects, bounds buffered responses, and rejects compressed streaming responses." [D: api/services/knowledge_fs_proxy.py:1]
- > "Test Forbidden when current_user is not an Account." [D: api/tests/unit_tests/controllers/service_api/dataset/rag_pipeline/test_rag_pipeline_workflow.py:658]
- > "PDFs loaded from a URL have no tenant/user context; image extraction must be skipped." [D: api/tests/unit_tests/core/rag/extractor/test_pdf_extractor.py:202]

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
