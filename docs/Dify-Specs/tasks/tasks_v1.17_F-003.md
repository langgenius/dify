---
title: Tasks v1.17 F-003 — Knowledge and RAG
id: F-003
status: draft
owner: TBD
updated: 2026-09-20
---

# Tasks v1.17 F-003 — Knowledge and RAG

> **As-built inventory, not a plan.** Every task below is already shipped; each points at the artifact that exists. `done-when` is written as the check that *would* prove it, because that is what the status column has to cash — and none of it has been cashed here.

## Tasks

| ID | Task | Artifact | Done-when |
| --- | --- | --- | --- |
| F-003-T001 | 30 operation(s) served by this module | `api/controllers/console/datasets/rag_pipeline/rag_pipeline_workflow.py` | `make test` green for its matching test module |
| F-003-T002 | 24 operation(s) served by this module | `api/controllers/console/datasets/datasets_document.py` | `make test` green for its matching test module |
| F-003-T003 | 20 operation(s) served by this module | `api/controllers/console/datasets/datasets.py` | `make test` green for its matching test module |
| F-003-T004 | 15 operation(s) served by this module | `api/controllers/console/datasets/datasets_segments.py` | `make test` green for its matching test module |
| F-003-T005 | 15 operation(s) served by this module | `api/controllers/service_api/dataset/document.py` | `make test` green for its matching test module |
| F-003-T006 | 13 operation(s) served by this module | `api/controllers/service_api/dataset/dataset.py` | `make test` green for its matching test module |
| F-003-T007 | 12 operation(s) served by this module | `api/controllers/console/datasets/rag_pipeline/datasource_auth.py` | `make test` green for its matching test module |
| F-003-T008 | 10 operation(s) served by this module | `api/controllers/console/datasets/rag_pipeline/rag_pipeline_draft_variable.py` | `make test` green for its matching test module |
| F-003-T009 | 9 operation(s) served by this module | `api/controllers/console/datasets/data_source.py` | `make test` green for its matching test module |
| F-003-T010 | 9 operation(s) served by this module | `api/controllers/service_api/dataset/segment.py` | `make test` green for its matching test module |
| F-003-T011 | 8 operation(s) served by this module | `api/controllers/console/datasets/external.py` | `make test` green for its matching test module |
| F-003-T012 | 7 operation(s) served by this module | `api/controllers/console/datasets/metadata.py` | `make test` green for its matching test module |
| F-003-T013 | 7 operation(s) served by this module | `api/controllers/service_api/dataset/metadata.py` | `make test` green for its matching test module |
| F-003-T014 | 6 operation(s) served by this module | `api/controllers/console/knowledge_fs_proxy.py` | `make test` green for its matching test module |
| F-003-T015 | 6 operation(s) served by this module | `api/controllers/console/datasets/rag_pipeline/rag_pipeline.py` | `make test` green for its matching test module |
| F-003-T016 | 4 operation(s) served by this module | `api/controllers/console/datasets/rag_pipeline/rag_pipeline_import.py` | `make test` green for its matching test module |
| F-003-T017 | 4 operation(s) served by this module | `api/controllers/service_api/dataset/rag_pipeline/rag_pipeline_workflow.py` | `make test` green for its matching test module |
| F-003-T018 | 3 operation(s) served by this module | `api/controllers/console/apikey.py` | `make test` green for its matching test module |
| F-003-T019 | 2 operation(s) served by this module | `api/controllers/console/datasets/rag_pipeline/rag_pipeline_datasets.py` | `make test` green for its matching test module |
| F-003-T020 | 2 operation(s) served by this module | `api/controllers/console/datasets/website.py` | `make test` green for its matching test module |
| F-003-T021 | 2 operation(s) served by this module | `api/controllers/service_api/dataset/hit_testing.py` | `make test` green for its matching test module |
| F-003-T022 | 1 operation(s) served by this module | `api/controllers/console/datasets/hit_testing.py` | `make test` green for its matching test module |
| F-003-T023 | 1 operation(s) served by this module | `api/controllers/console/datasets/rag_pipeline/datasource_content_preview.py` | `make test` green for its matching test module |
| F-003-T024 | 1 operation(s) served by this module | `api/controllers/console/explore/trial.py` | `make test` green for its matching test module |
| F-003-T025 | 1 operation(s) served by this module | `api/controllers/inner_api/knowledge/retrieval.py` | `make test` green for its matching test module |
| F-003-T026 | Entity `app_dataset_joins` | `api/models/dataset.py:976` | migration applies and the ORM class maps it |
| F-003-T027 | Entity `child_chunks` | `api/models/dataset.py:919` | migration applies and the ORM class maps it |
| F-003-T028 | Entity `data_source_api_key_auth_bindings` | `api/models/source.py:53` | migration applies and the ORM class maps it |
| F-003-T029 | Entity `data_source_oauth_bindings` | `api/models/source.py:14` | migration applies and the ORM class maps it |
| F-003-T030 | Entity `dataset_api_token_bindings` | `api/models/model.py:2295` | migration applies and the ORM class maps it |
| F-003-T031 | Entity `dataset_auto_disable_logs` | `api/models/dataset.py:1325` | migration applies and the ORM class maps it |
| F-003-T032 | Entity `dataset_collection_bindings` | `api/models/dataset.py:1145` | migration applies and the ORM class maps it |
| F-003-T033 | Entity `dataset_keyword_tables` | `api/models/dataset.py:1058` | migration applies and the ORM class maps it |
| F-003-T034 | Entity `dataset_metadata_bindings` | `api/models/dataset.py:1394` | migration applies and the ORM class maps it |
| F-003-T035 | Entity `dataset_metadatas` | `api/models/dataset.py:1365` | migration applies and the ORM class maps it |
| F-003-T036 | Entity `dataset_permissions` | `api/models/dataset.py:1221` | migration applies and the ORM class maps it |
| F-003-T037 | Entity `dataset_process_rules` | `api/models/dataset.py:394` | migration applies and the ORM class maps it |
| F-003-T038 | Entity `dataset_queries` | `api/models/dataset.py:1001` | migration applies and the ORM class maps it |
| F-003-T039 | Entity `dataset_retriever_resources` | `api/models/model.py:2576` | migration applies and the ORM class maps it |
| F-003-T040 | Entity `datasets` | `api/models/dataset.py:105` | migration applies and the ORM class maps it |
| F-003-T041 | Entity `datasource_oauth_params` | `api/models/oauth.py:15` | migration applies and the ORM class maps it |
| F-003-T042 | Entity `datasource_oauth_tenant_params` | `api/models/oauth.py:69` | migration applies and the ORM class maps it |
| F-003-T043 | Entity `datasource_providers` | `api/models/oauth.py:30` | migration applies and the ORM class maps it |
| F-003-T044 | Entity `document_pipeline_execution_logs` | `api/models/dataset.py:1517` | migration applies and the ORM class maps it |
| F-003-T045 | Entity `document_segment_summaries` | `api/models/dataset.py:1589` | migration applies and the ORM class maps it |
| F-003-T046 | Entity `document_segments` | `api/models/dataset.py:721` | migration applies and the ORM class maps it |
| F-003-T047 | Entity `documents` | `api/models/dataset.py:438` | migration applies and the ORM class maps it |
| F-003-T048 | Entity `embeddings` | `api/models/dataset.py:1113` | migration applies and the ORM class maps it |
| F-003-T049 | Entity `external_knowledge_apis` | `api/models/dataset.py:1246` | migration applies and the ORM class maps it |
| F-003-T050 | Entity `external_knowledge_bindings` | `api/models/dataset.py:1294` | migration applies and the ORM class maps it |
| F-003-T051 | Entity `pipeline_built_in_templates` | `api/models/dataset.py:1417` | migration applies and the ORM class maps it |
| F-003-T052 | Entity `pipeline_customized_templates` | `api/models/dataset.py:1446` | migration applies and the ORM class maps it |
| F-003-T053 | Entity `pipeline_recommended_plugins` | `api/models/dataset.py:1539` | migration applies and the ORM class maps it |
| F-003-T054 | Entity `pipelines` | `api/models/dataset.py:1485` | migration applies and the ORM class maps it |
| F-003-T055 | Entity `segment_attachment_bindings` | `api/models/dataset.py:1563` | migration applies and the ORM class maps it |
| F-003-T056 | Entity `tidb_auth_bindings` | `api/models/dataset.py:1170` | migration applies and the ORM class maps it |

56 tasks.

## Status

Every row is `todo` in the table above and must move `todo -> wip -> done` through `product-docs-flow/scripts/docs_flow.py task`; the transition guard is the check [D: docs/Dify-Specs/status-model.md].

No row may read `done` without a command and its result in the note.

OPEN: this inventory is one task per module and one per entity. Is that the unit of work the team recognises, or should a task be a user-visible capability? The repository records commits, not tasks.

## Open questions

- OPEN: what was the original sequencing? A working tree preserves the result and not the order.
- OPEN: which of these were delivered together as one release? Tags would say; the repository has none [D: survey of `git tag`].
