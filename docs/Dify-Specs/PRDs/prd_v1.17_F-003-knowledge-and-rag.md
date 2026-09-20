---
title: PRD v1.17 F-003 — Knowledge and RAG
id: F-003
status: draft
owner: TBD
updated: 2026-09-20
---

# PRD v1.17 F-003 — Knowledge and RAG

> **Reconstructed, and the weakest document in this hub.** A requirement states intent, and intent is not in a repository. Every story below is inferred from a group of endpoints and test names — evidence that the behaviour exists, never evidence that it was wanted, and never evidence of what it was wanted *for*.

## Summary

212 operations serve this feature [D: api/controllers/]. What they let a user accomplish is summarised by the stories below.

OPEN: what problem does this feature solve, for whom, and what changed for them when it shipped? Not recoverable.

## User stories

**F-003-US1** — As a knowledge curator, I want to create a dataset and ingest documents into it, so that I can give an application knowledge.

  I: inferred from the existence of `/console/api/datasets`, document endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-003-US2** — As a knowledge curator, I want to watch indexing progress and retry failures, so that I can know when the corpus is usable.

  I: inferred from the existence of indexing-status and indexing-estimate endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-003-US3** — As a knowledge curator, I want to manage segments and child chunks of a document, so that I can fix how a document was split.

  I: inferred from the existence of segment endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-003-US4** — As a knowledge curator, I want to attach metadata to documents and filter retrieval by it, so that I can scope what a query can see.

  I: inferred from the existence of `/console/api/datasets/<id>/metadata` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-003-US5** — As a knowledge curator, I want to test retrieval against a dataset before wiring it up, so that I can check the corpus answers the question.

  I: inferred from the existence of hit-testing endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-003-US6** — As a knowledge curator, I want to build a knowledge pipeline from a template, so that I can reuse an ingestion design.

  I: inferred from the existence of rag_pipeline endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-003-US7** — As a knowledge curator, I want to connect an external knowledge API instead of indexing locally, so that I can reuse a corpus that already exists.

  I: inferred from the existence of external knowledge endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

OPEN: is this the list of things users actually do, or only the list the API makes possible? The two differ, and only usage data settles it.

## Acceptance criteria

Criteria are lifted from test names where a test states a contract in words — a test named "refuses X" is a Given/When/Then, and it is evidence the behaviour is wanted rather than merely present.

- `test_add_documents_rejects_mismatched_token_counts` [D: api/tests/unit_tests/core/rag/docstore/test_dataset_docstore.py:322]
- `test_add_documents_with_invalid_document_type` [D: api/tests/unit_tests/core/rag/docstore/test_dataset_docstore.py:276]
- `test_admin_operation_rejects_legacy_editors_before_rbac` [D: api/tests/unit_tests/services/test_knowledge_fs_proxy.py:513]
- `test_args_with_content_only` [D: api/tests/unit_tests/controllers/service_api/dataset/test_dataset_segment.py:844]
- `test_as_bytes_raises_for_invalid_state` [D: api/tests/unit_tests/core/rag/extractor/blob/test_blob.py:53]
- `test_as_string_raises_for_invalid_state` [D: api/tests/unit_tests/core/rag/extractor/blob/test_blob.py:35]
- `test_authorization_capability_binding_cannot_be_mutated` [D: api/tests/unit_tests/services/test_knowledge_fs_proxy.py:417]
- `test_authorization_capability_cannot_be_constructed_directly` [D: api/tests/unit_tests/services/test_knowledge_fs_proxy.py:386]
- `test_authorization_capability_cannot_be_reused` [D: api/tests/unit_tests/services/test_knowledge_fs_proxy.py:442]
- `test_authorization_rejects_workspace_rbac_denial` [D: api/tests/unit_tests/services/test_knowledge_fs_proxy.py:465]

OPEN: no story above has acceptance criteria covering its happy path in these terms. The suite tests behaviour; it does not restate requirements.

## Implementation status

| story | Status | Evidence |
| --- | --- | --- |
| F-003-US1 | todo | — |
| F-003-US2 | todo | — |
| F-003-US3 | todo | — |
| F-003-US4 | todo | — |
| F-003-US5 | todo | — |
| F-003-US6 | todo | — |
| F-003-US7 | todo | — |

No story may read `done` without the test command and its result in the note [D: docs/Dify-Specs/status-model.md].

## Scope boundaries

OPEN: what was deliberately left out of this feature, and why? A working tree records what exists and keeps no record of what was declined.

## Dependencies

- F-005 — every operation is tenant-scoped and RBAC-guarded [D: api/controllers/console/wraps.py]

OPEN: which external systems is this feature contractually dependent on, as opposed to merely able to use?

## Metrics

OPEN: how is success measured for this feature? No metric, target or SLO appears anywhere in the repository. Telemetry is collected [D: api/tasks/enterprise_telemetry_task.py:19] but what it is read for is not stated.

