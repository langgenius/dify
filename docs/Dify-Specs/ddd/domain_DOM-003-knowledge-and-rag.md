---
title: Domain — Knowledge and RAG
id: DOM-003
feature: F-003
kind: domain
status: draft
owner: TBD
updated: 2026-09-20
---

# Domain — Knowledge and RAG (DOM-003)

> Reconstructed from the code. Terms are the identifiers the code uses; rules are promoted from comments that state a rule, and each names the code that enforces it.

## Ubiquitous language

The enumerations the schema constrains are the domain's own vocabulary — every value below is a string the database will accept and no other.

| Term | Permitted values | Source |
| --- | --- | --- |
| `datasource_providers.visibility` | only_me, all_team_members, partial_members | `api/models/oauth.py:30` |

OPEN: several enum values carry no visible meaning beyond their spelling. What distinguishes them to a user?

## Actors

| Actor | Does | Evidence |
| --- | --- | --- |
| Knowledge curator | creates datasets and ingests documents | `api/controllers/console/datasets/datasets.py` |
| Retrieval caller | queries a dataset at run time | `api/core/rag/retrieval/dataset_retrieval.py` |

OPEN: which of these are distinct personas to the business, and which are the same person in two modes? The code models permissions, not people.

## Business rules

Promoted from 10 rule-bearing comments in this feature's files. Each is `I:` — a comment is evidence that someone knew the rule, not proof the code still enforces it.

**DOM-003-R1** — I: Use a lazy proxy so cleanup paths (delete_by_ids / delete / text_exists) never transitively trigger billing API calls during ``Vector(dataset, session=...)`` construction. The real embedding model is materialized only when an ``embed_*`` method is actually invoked (i.e. create / search paths). — basis: stated in a comment at the enforcement site [D: api/core/rag/datasource/vdb/vector_factory.py:122]

**DOM-003-R2** — I: Top-level request payload for the inner knowledge retrieval endpoint. Request validation enforces the endpoint's behavioral contract: callers must provide at least one dataset ID, at least one of ``query`` or ``attachment_ids``, and a text query for ``single`` retrieval mode. — basis: stated in a comment at the enforcement site [D: api/services/entities/knowledge_retrieval_inner.py:129]

**DOM-003-R3** — I: Generate summary index for specified documents. This endpoint checks if the dataset configuration supports summary generation (indexing_technique must be 'high_quality' and summary_index_setting.enable must be true), then asynchronously generates summary indexes for the provided documents. — basis: stated in a comment at the enforcement site [D: api/controllers/console/datasets/datasets_document.py:1673]

**DOM-003-R4** — I: Use a plain Session so that caught exceptions inside the service (which return FAILED status instead of re-raising) do not leave the transaction in a closed state that a .begin() context manager cannot handle. See app_import.py for the canonical pattern. — basis: stated in a comment at the enforcement site [D: api/controllers/console/datasets/rag_pipeline/rag_pipeline_import.py:90]

**DOM-003-R5** — I: Reuse the caller-bound model instance for both schema resolution and downstream planner/invoke calls so a single request never mixes tenant-scope and request-bound runtimes. — basis: stated in a comment at the enforcement site [D: api/core/rag/retrieval/dataset_retrieval.py:436]

**DOM-003-R6** — I: Reserve the whole retry batch before changing any document state. Redis lock acquisition is intentionally coupled to this bounded status transaction so a concurrent request cannot partially admit the batch. — basis: stated in a comment at the enforcement site [D: api/services/dataset_service.py:2157]

**DOM-003-R7** — I: Without an account we cannot resolve RBAC resource visibility. — basis: stated in a comment at the enforcement site [D: api/services/dataset_service.py:328]

**DOM-003-R8** — I: Authorize and forward the explicitly enabled KnowledgeFS Console operations. The dedicated request path uses Dify's shared SSRF policy, never follows redirects, bounds buffered responses, and rejects compressed streaming responses. — basis: stated in a comment at the enforcement site [D: api/services/knowledge_fs_proxy.py:1]

**DOM-003-R9** — I: Test Forbidden when current_user is not an Account. — basis: stated in a comment at the enforcement site [D: api/tests/unit_tests/controllers/service_api/dataset/rag_pipeline/test_rag_pipeline_workflow.py:658]

**DOM-003-R10** — I: PDFs loaded from a URL have no tenant/user context; image extraction must be skipped. — basis: stated in a comment at the enforcement site [D: api/tests/unit_tests/core/rag/extractor/test_pdf_extractor.py:202]

OPEN: every rule above states *what*; none states *why*. Which are regulatory, which are product decisions, and which are workarounds?

## Process flow

Recoverable only as call sequence, not as a business process. See `architect/feature_v1.17_F-003_architect.md` and the endpoint table in `data/api-contract_v1.17_F-003.md`.

OPEN: what is the intended happy path from a user's point of view? A route table gives the operations, never the order a person performs them in.

## Invariants

Enforced by the database for this feature: 249 not-null columns and 5 cross-column uniqueness constraints [D: api/models/].

- `dataset_api_token_bindings` is unique on (`api_token_id`, `dataset_id`) [D: api/models/model.py:2295]
- `datasource_oauth_params` is unique on (`plugin_id`, `provider`) [D: api/models/oauth.py:15]
- `datasource_oauth_tenant_params` is unique on (`tenant_id`, `plugin_id`, `provider`) [D: api/models/oauth.py:69]
- `datasource_providers` is unique on (`tenant_id`, `plugin_id`, `provider`, `name`) [D: api/models/oauth.py:30]
- `embeddings` is unique on (`model_name`, `hash`, `provider_name`) [D: api/models/dataset.py:1113]

I: referential invariants between these tables are enforced in service code, not by the database — basis: only 8 `ForeignKey()` declarations exist across all 143 tables [D: api/models/].

OPEN: which invariants does the business require that nothing in the code checks? Those are the ones a bad migration or a direct database write would break silently.

## Implementation status

One row per rule above. States and what `done` costs: `status-model.md`.

| Rule | Status | Evidence |
| --- | --- | --- |
| DOM-003-R1 | todo | — |
| DOM-003-R2 | todo | — |
| DOM-003-R3 | todo | — |
| DOM-003-R4 | todo | — |
| DOM-003-R5 | todo | — |
| DOM-003-R6 | todo | — |
| DOM-003-R7 | todo | — |
| DOM-003-R8 | todo | — |
| DOM-003-R9 | todo | — |
| DOM-003-R10 | todo | — |

## Open questions

- OPEN: is this feature boundary the one the team recognises? It was drawn from handler directories and table ownership, not from anyone's statement of the domain.
- OPEN: no rule in this document is named by any test. Which of them are actually verified, and which only exist as prose next to the code?
- OPEN: what is the source of truth when a comment and the code beside it disagree?
