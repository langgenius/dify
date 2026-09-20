---
title: Test Plan v1.17 F-003 — Knowledge and RAG
id: F-003
status: draft
owner: TBD
updated: 2026-09-20
---

# Test Plan v1.17 F-003 — Knowledge and RAG

> **This is an as-built record.** It describes the suite that exists, not a suite to be written. Its purpose is the coverage holes listed below.

## Scope and command

2779 test cases across 157 files carry this feature's subject matter [D: survey of test function and `describe`/`it` names].

The project's own command is `make test` [D: Makefile:104], which runs `uv run --project api --dev pytest` in two passes — everything except `api/tests/unit_tests/controllers`, then the controllers [D: Makefile:106].

Docker-backed integration suites are CI-owned and are not expected to run locally [D: api/AGENTS.md:14].

## Test files

| File | Cases |
| --- | --- |
| `api/tests/unit_tests/core/rag/retrieval/test_dataset_retrieval.py` | 135 |
| `api/tests/unit_tests/core/rag/splitter/test_text_splitter.py` | 109 |
| `api/tests/unit_tests/controllers/service_api/dataset/test_dataset_segment.py` | 109 |
| `api/tests/unit_tests/services/test_external_dataset_service.py` | 98 |
| `api/tests/unit_tests/services/rag_pipeline/test_rag_pipeline_service.py` | 92 |
| `api/tests/unit_tests/controllers/service_api/dataset/test_document.py` | 90 |
| `api/tests/unit_tests/controllers/console/datasets/test_datasets.py` | 81 |
| `api/tests/unit_tests/controllers/console/datasets/test_datasets_document.py` | 71 |
| `api/tests/unit_tests/services/test_dataset_service_document.py` | 70 |
| `api/tests/unit_tests/models/test_dataset_models.py` | 64 |
| `api/tests/unit_tests/services/test_dataset_service_dataset.py` | 53 |
| `api/tests/unit_tests/controllers/service_api/dataset/rag_pipeline/test_rag_pipeline_workflow.py` | 49 |
| `api/tests/unit_tests/services/test_dataset_service_segment.py` | 46 |
| `api/tests/unit_tests/core/rag/rerank/test_reranker.py` | 45 |
| `api/tests/unit_tests/core/rag/indexing/test_indexing_runner.py` | 43 |

…142 more files.


Enumerating all 24,695 cases in the repository into this hub would duplicate the suite without adding information; the suite is the record and this document points at it.

## Representative cases

Cases whose names state a contract rather than an implementation detail:

- `test_add_documents_rejects_mismatched_token_counts` [D: api/tests/unit_tests/core/rag/docstore/test_dataset_docstore.py:322]
- `test_admin_operation_rejects_legacy_editors_before_rbac` [D: api/tests/unit_tests/services/test_knowledge_fs_proxy.py:513]
- `test_args_with_content_only` [D: api/tests/unit_tests/controllers/service_api/dataset/test_dataset_segment.py:844]
- `test_authorization_capability_binding_cannot_be_mutated` [D: api/tests/unit_tests/services/test_knowledge_fs_proxy.py:417]
- `test_authorization_capability_cannot_be_constructed_directly` [D: api/tests/unit_tests/services/test_knowledge_fs_proxy.py:386]
- `test_authorization_capability_cannot_be_reused` [D: api/tests/unit_tests/services/test_knowledge_fs_proxy.py:442]
- `test_authorization_rejects_workspace_rbac_denial` [D: api/tests/unit_tests/services/test_knowledge_fs_proxy.py:465]
- `test_authorized_service_denial_is_exposed_as_forbidden` [D: api/tests/unit_tests/controllers/console/test_knowledge_fs_proxy.py:610]
- `test_batch_download_zip_rejects_non_upload_file_document` [D: api/tests/unit_tests/controllers/console/datasets/test_datasets_document_download.py:319]
- `test_batch_import_with_async_task_failure` [D: api/tests/unit_tests/controllers/console/datasets/test_datasets_segments.py:1277]
- `test_batch_processing_sandbox_plan_single_document_only` [D: api/tests/test_containers_integration_tests/tasks/test_dataset_indexing_task.py:277]
- `test_batch_update_document_status_rejects_indexing_documents` [D: api/tests/unit_tests/services/test_dataset_service_document.py:1445]
- `test_batch_update_document_status_rolls_back_when_commit_fails` [D: api/tests/unit_tests/services/test_dataset_service_document.py:1462]
- `test_bind_tags_forbidden` [D: api/tests/unit_tests/controllers/service_api/dataset/test_dataset_tag_apis.py:290]
- `test_buffered_response_rejects_non_empty_body_without_content_type` [D: api/tests/unit_tests/services/test_knowledge_fs_proxy.py:585]

## Coverage holes

211 of 212 operations sit in a handler file that has a matching `test_<name>.py`; 1 do not [D: api/tests/].

I: a matching test file is a weak proxy for coverage — basis: it proves a test module exists for that handler module, never that a given endpoint or branch is exercised [D: api/tests/].

Handler modules in this feature with no matching test file:

- `api/controllers/inner_api/knowledge/retrieval.py`

OPEN: what coverage level is required for this feature? `api-coverage` runs in CI [D: .github/workflows/api-tests.yml:154] but no threshold is stated in the repository.

## Traceability

No test in this repository names a `F-003-US<k>` story or a `DOM-*-R<k>` rule, so no automated link exists between a test and a requirement [D: api/tests/].

OPEN: should tests carry requirement IDs? Without them the status tables in the domain and PRD documents cannot be filled from a test run, and every row stays unverified.

## Implementation status

| Case group | Status | Evidence |
| --- | --- | --- |
| Knowledge and RAG suite | todo | — |
