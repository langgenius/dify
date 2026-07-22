# KnowledgeFS Master Iteration Plan

> Created: 2026-06-24
> Updated: 2026-07-16
> Source directory: `.harness/docs`
> Status: current executable master plan
> Rule: historical plans remain source records; this file is the first document to use
> when deciding the next implementation slice.

## 1. Purpose

This document reorganizes all iteration plans under `.harness/docs` into one concrete,
detailed, execution-ready plan.

The older plans are not deleted or overwritten. They remain the audit trail and hold
fine-grained historical context. This master plan is the current working plan: it
combines what has already shipped, what is partially done, what should happen next,
and how each slice should be accepted and verified.

## 2. Source Documents

| Source | What It Contains | Current Use In This Master Plan |
|---|---|---|
| `.harness/docs/iteration-plan.md` | Original 6-phase Knowledge Platform roadmap, architecture guardrails, sprint calendar, local MVP closure, queryable ingestion, durable runtime, Admin repair, and code-health tracks. | Preserved as historical roadmap and phase library. Active items are re-ranked below. |
| `.harness/docs/code-review-remediation-iteration-plan.md` | Review issue remediation, provider reliability, migration lifecycle, command registry type safety, historical compute guardrails, API decomposition log. | Mostly completed. Remaining value is residual API/gateway decomposition and code-health guardrails. |
| `.harness/docs/juicefs-inspired-hardening-iteration-plan.md` | KnowledgeFS manifest, commit ledger, artifact segmentation, consistency, sessions, leases, fsck, gc, quota, atomic projection publication, Admin/MCP operator UX. | Implemented 2026-05-27. Kept as completed production-control-plane baseline. |
| `.harness/docs/pageindex-inspired-outline-iteration-plan.md` | PageIndex-style `DocumentOutline`, section hierarchy, TOC/title/page/offset metadata, outline summaries, KnowledgeFS/MCP surface, research tree search. | Core implemented. Remaining work is quality hardening and regression evaluation. |
| `.harness/docs/multimodal-knowledgefs-iteration-plan.md` | `DocumentMultimodalManifest`, table/image/code/page inventory, visual assets, thumbnails, VLM answer support, visual embeddings, Admin browser, evals. | Core functional capability implemented. Remaining work is external QA fixtures, provider conformance, and richer trace UX. |
| `.harness/docs/rag-platform-redesign-technical-selection.md` | Architecture source of truth and technology choices. | Updated to reflect this master plan, PageIndex-inspired outlines, native multimodal contracts, and visual indexing. |
| Dify prototype `/datasets` | Product UX target for dataset list/detail, overview readiness, sources, documents, evidence, quality, settings, agent access, and pipeline surfaces. | Used as the Admin/product parity target before deeper quality-only iteration. |

## 3. Architecture Guardrails

All future slices must keep the current platform boundaries:

- TypeScript owns orchestration, IO, Hono APIs, MCP tools, Admin BFF integration,
  database access, object storage, cache, jobs, provider adapters, KnowledgeFS,
  SourceFS, EvidenceFS, retrieval, generation, and operator workflows.
- Next.js owns the Admin Console and may use thin BFF routes only for UI ergonomics.
  Core knowledge, retrieval, ingestion, provider, permission, job, and MCP behavior
  must remain behind Hono APIs.
- TypeScript owns bounded pure compute: chunking, token counting, RRF fusion,
  evidence packing, and text diff through `packages/compute`.
- Compute modules must not perform database, network, filesystem, cache, or streaming IO.
- Search remains database-native by default: TiDB Cloud for SaaS and PostgreSQL +
  pgvector + FTS for Standalone, behind `DatabaseAdapter`.
- Document parsing uses native TypeScript parsers for simple formats and self-hosted
  Unstructured or optional document AI/OCR APIs for complex formats.
- Safe shell remains an allowlisted command dispatcher over registered
  SourceFS/KnowledgeFS/EvidenceFS commands. It must never execute host shell commands.
- MCP and OpenAPI remain first-class. A2A remains isolated and experimental.
- Evaluation starts small, then becomes a regression gate for retrieval, citation,
  outline localization, multimodal localization, and research-mode behavior.

## 4. Product Target

The desired mode is:

1. During parsing/compilation, build a PageIndex-inspired document directory tree.
2. Segment semantically, not only by fixed token windows.
3. Produce summaries at appropriate structural levels.
4. Attach each paragraph/table/image/code/page evidence item to:
   - TOC/section path;
   - page number and page range;
   - character offset range;
   - title location;
   - bounding box when available;
   - parse element id;
   - generated `KnowledgeNode` id;
   - asset descriptor path when multimodal.
5. Keep raw paragraph/table/image/code leaf nodes indexed for embedding, full-text
   search, graph search, reranking, and evidence packing.
6. Preserve three retrieval modes:
   - `fast`: dense + full-text + metadata filters over raw/textualized evidence.
   - `deep`: larger hybrid fanout, reranking, graph expansion, table/image/OCR/visual
     candidates, summary/outline metadata, and stronger verification.
   - `research`: outline and multimodal manifest inspection first, deterministic
     reasoning tree search, selected range opening, then hybrid/graph/rerank evidence
     completion and traceable synthesis.

## 5. Current State

| Area | Consolidated Status | What Is Already Done | Remaining Work |
|---|---|---|---|
| Local usable MVP | Done | Core Closure CC.1-CC.7: real Admin workspace bootstrap, upload UI, document/artifact read, live health/readiness, query path, preview labeling, local smoke. | None for this plan. |
| Queryable ingestion | Done | QI.1-QI.5: upload creates nodes, local compute runtime, local generator over nodes, evidence query smoke, Admin BFF upload smoke. | None for this plan. |
| Durable local runtime | Done | DLR.1-DLR.15: PostgreSQL executor, DB repository bundle, migrations, `.env`, durable smoke, application packaging, app Compose guardrails, API/Admin images and smoke gates. | None for this plan. |
| JuiceFS hardening | Done | JH.1-JH.7: manifests, commit ledger, artifact segments, consistency/cache contracts, sessions/leases, fsck/gc/status/stats, quota/projection hardening, Admin/MCP operator UX. | Keep docs/runbooks aligned when related behavior changes. |
| PageIndex outline | Mostly done | Deterministic schema/builder/repository/API/KnowledgeFS; summary enhancer; outline-guided research trace; Admin outline browser and trace panel; first localization eval. | Title/page quality hardening, recursive subdivision, stronger long-document evals. |
| Multimodal KnowledgeFS | Mostly done | Manifest, metadata normalization, asset extraction, PDF rasterization, thumbnails, KnowledgeFS descriptors, VLM answer providers, visual embeddings, visual retrieval metrics, Admin browser, eval utilities. | External QA fixtures, provider conformance packs, richer trace drill-downs. |
| Prototype product parity | Planned | Underlying APIs and data contracts exist in pieces across KnowledgeFS, SourceFS, EvidenceFS, retrieval, quality, and Admin. | Align Admin routes and workflow APIs with the prototype: dataset list/detail shell, sources, documents, evidence, quality, settings, agent access, and pipeline mode. |
| Admin integration | Active | AIR.1-AIR.2 done: upload/readiness/citation paths and local/Compose upstream wiring repaired. | AIR.3/AIR.4: preview panel audit and outline/multimodal trace UX. |
| API/code health | Active | R1-R5 complete; R6 has many module extractions; GF.1-GF.5 complete. | GF.6/GF.7/GF.8: focused worker tests, residual gateway composition cleanup, plan-to-code traceability. |
| Original Phase 4-6 advanced features | Partially done | Summary, graph, semantic views, research tasks, workspace snapshots, evaluation utilities exist in pieces per prior changes. | Fold into the active roadmap below only where they advance outline/multimodal/research/eval quality. |

## 6. Execution Order

Work should proceed in this order unless a production regression appears:

1. Documentation alignment and planning source of truth.
2. Prototype product surface parity for the dataset workspace.
3. PageIndex outline quality hardening.
4. Multimodal functional completion.
5. Admin integration honesty and trace drill-downs.
6. API/code-health closure.
7. Research-mode completeness over outline + multimodal + graph evidence.
8. Evaluation governance and CI regression hardening.
9. Optional provider, deployment, and adapter expansion.

Every slice should:

- start with a focused test or fixture where code changes are involved;
- keep Hono/Next/package boundaries intact;
- update `.harness/changes`;
- update this master plan status when a planned item becomes done;
- run targeted tests plus `git diff --check`;
- commit and push after the task is complete.

## 7. Milestone M0: Planning and Documentation Alignment

Goal: make `.harness/docs` coherent enough that future implementation can follow one
plan without losing historical context.

| ID | Source | Status | Task | Details | Acceptance | Verification |
|---|---|---|---|---|---|---|
| M0.1 | All docs | Done 2026-06-24 | Create master plan | Replace short consolidated index with a detailed executable roadmap. | This file names every source plan, current status, remaining functional scope, dependencies, acceptance, and verification. | `rg` for all source plan filenames. |
| M0.2 | `iteration-plan.md` | Done 2026-06-24 | Reframe original plan | Mark original plan as historical roadmap and point to this master plan for current execution. | Readers do not confuse old `Draft`/`Active` labels with current priority. | Markdown diff review. |
| M0.3 | `rag-platform-redesign-technical-selection.md` | Done 2026-06-24 | Refresh architecture source | Add current outline, multimodal, visual indexing, and VLM answer architecture. | Technical selection names `DocumentOutline`, `DocumentMultimodalManifest`, visual assets, visual embeddings, and outline-guided research. | `rg` for contract names. |
| M0.4 | `.harness/changes` | Done 2026-06-24 | Add change record | Record why planning was reorganized and which files changed. | Change record exists with summary and file scope. | `rg "Consolidated Iteration Plan Refresh" .harness/changes`. |

## 8. Milestone M0.5: Prototype Product Surface Alignment

Goal: make the KnowledgeFS Admin Console and API workflow match the current
`/datasets` prototype before spending more time on quality-only PageIndex or
multimodal polishing.

This does not replace the backend architecture. It turns existing contracts into the
product surfaces users will actually operate: dataset cards, workspace navigation,
source freshness, document/index status, evidence tests, quality management,
retrieval settings, agent access, and pipeline mode.

### M0.5.1 Prototype Requirements Captured

The prototype requires these first-class surfaces:

- Dataset list with create modes: create knowledge, create from knowledge pipeline,
  connect external knowledge base, search, tags, permission, document count,
  readiness/status, related app count, and deletion affordance.
- Dataset detail shell with left navigation for Overview, Sources, Documents,
  Evidence, Quality, Settings, conditional Pipeline, and Agent Access.
- Overview readiness summary with manifest version, storage/provider status, parser
  policy, index-slice readiness, commit queue, active leases, recent activity, cache
  footprint, evidence conflicts, missing evidence, golden-question drift, stale
  projections, and policy snapshots.
- Sources workspace for website crawl, online documents, and online drive providers,
  including provider catalog, connection metadata, source permissions, sync policy,
  sync status, source actions, and page/file preview selection.
- Documents workspace for document search, parser/index/projection status, artifact
  links, job state, bulk operations, reindex, delete, and outline/multimodal drill-down.
- Evidence workspace for running `fast`, `deep`, and `research` retrieval tests,
  reviewing evidence bundles, conflicts, missing evidence, permission limitations,
  and trace steps.
- Quality workspace for golden questions, production bad cases, answer trace history,
  expected evidence ids, annotations, tags, permissions, and mode comparison.
- Settings workspace for basic info, service API, external knowledge API delegation,
  default retrieval, multimodal toggle, score handling, processing/index policy, and
  retention policy.
- Agent Access workspace exposing the productized MCP endpoint, CLI/SKILL setup, and
  tools: `knowledge_query`, `knowledge_trace_get`, `knowledge_fs_tree`,
  `knowledge_fs_grep`, `knowledge_fs_cat`, and `knowledge_research_start`.
- Knowledge Pipeline runtime mode with create-from-pipeline, stage editor, last-run
  summary, publish state, source/document/usage cards, and projection publication.

### M0.5.2 Detailed Work

| ID | Priority | Status | Depends On | Task | Implementation Notes | Acceptance | Verification |
|---|---|---|---|---|---|---|---|
| M0.5.2.1 | P0 | Planned | M0 | Dataset list and create flows | Add live Admin route/API wiring for dataset cards, search, tags, permission, related app count, readiness, create knowledge, create from pipeline, external knowledge, and delete. | The dataset list can represent every prototype card/action with live or explicitly disabled backing behavior. | Admin page tests, BFF contract tests, API dataset list/create/delete tests. |
| M0.5.2.2 | P0 | Planned | M0.5.2.1 | Dataset detail shell | Implement the prototype navigation model, dataset sidebar metadata, API/Agent access entry points, conditional external-provider and pipeline visibility. | Detail pages preserve route state and show correct nav items for internal, external, and pipeline datasets. | Admin route tests and snapshot tests. |
| M0.5.2.3 | P0 | Planned | JH baseline + EvidenceFS | Overview readiness aggregator | Create one status endpoint/BFF that merges manifest, parser policy, index slices, commit queue, leases, cache, recent activity, evidence conflicts, missing evidence, golden drift, stale projections, and policy snapshot. | Overview explains readiness and attention items without relying on raw JSON inspection. | API status tests, Admin overview tests, fixture snapshots. |
| M0.5.2.4 | P0 | Planned | SourceFS/ResourceMount | Sources provider workflow | Productize website crawl, online docs, and online drive sources with provider catalog, connection metadata, permissions, sync policy, preview selection, sync now, retry, enable/disable, and open-source actions. | Source rows and actions match prototype semantics and report active/syncing/error/disabled states. | Source API tests, provider adapter mocks, Admin Sources tests. |
| M0.5.2.5 | P0 | Planned | DLR/JH + M1/M2 | Documents workspace | Add document table/search/bulk actions with parser/index/projection status, artifact links, job state, reindex/delete, outline, multimodal, and citation drill-down. | Operators can inspect indexed content and fix document-level failures from one page. | Document API tests, Admin Documents tests, worker/job fixture tests. |
| M0.5.2.6 | P0 | Planned | Retrieval + EvidenceFS | Evidence test workspace | Build the prototype workflow to run fast/deep/research tests, inspect evidence bundles, answerability, conflicts, missing evidence, permission limits, and trace steps. | Evidence tab can reproduce and explain the current answer path for all retrieval modes. | Retrieval API tests, trace fixture tests, Admin Evidence tests. |
| M0.5.2.7 | P1 | Planned | M0.5.2.6 + M6 | Quality workspace | Manage golden questions, expected evidence ids, production bad cases, trace history, tags, annotations, permissions, and mode comparison. | Quality tab can turn evidence failures into durable golden/bad-case records. | Quality API tests, Admin Quality tests, eval fixture tests. |
| M0.5.2.8 | P1 | Planned | M0.5.2.2 | Settings/API workspace | Wire basic info, service API, external API delegation, topK, score threshold, score handling, default retrieval mode, rerank, multimodal toggle, parser/chunking/embedding/index strategy, and retention scope. | Settings tab controls the same policies shown by the prototype and overview policy snapshot. | Settings API tests, Admin Settings tests. |
| M0.5.2.9 | P1 | Planned | MCP + KnowledgeFS | Agent Access workspace | Productize MCP/CLI/SKILL instructions and live tool metadata for query, trace, tree, grep, cat, and research start. | Agent Access page exposes copyable, correct commands and reflects enabled tools for the dataset. | MCP contract tests, Admin Agent Access tests. |
| M0.5.2.10 | P1 | Planned | Pipeline skeleton | Knowledge Pipeline mode | Add runtime-mode support, create-from-pipeline flow, stage editor shell, publish/draft state, last-run summary, and projection publication status. | Pipeline datasets show the Pipeline tab and non-pipeline datasets do not. | Pipeline API tests and Admin Pipeline tests. |
| M0.5.2.11 | P1 | Planned | M0.5.2.1-M0.5.2.10 | Prototype conformance matrix | Maintain a route/action/data matrix mapping prototype UI affordances to live, disabled, or planned behavior. | Future Admin work cannot drift from the product target silently. | Markdown matrix plus Admin action-conformance test. |

## 9. Milestone M1: PageIndex-Inspired Outline Completion

Goal: make `DocumentOutline` a reliable structural fact layer for long-document
navigation and research-mode reasoning tree search.

### M1.1 Completed Baseline

| ID | Status | Capability | Acceptance Already Met |
|---|---|---|---|
| PI.1 | Done | `DocumentOutline` schema, deterministic builder, in-memory/database persistence, document outline read API. | Every parsed document can return a deterministic outline with stable node ids, section paths, page/offset ranges, title metadata, summaries, and source links. |
| PI.2 | Done | KnowledgeFS outline and section paths. | `/knowledge/docs/{document}/outline.json` and section-range paths are browsable. |
| PI.3 | Done | Optional summary enhancer. | Summary provider can add provider/model/promptVersion metadata and deterministic fallback remains available. |
| PI.4 | Done | Research-mode outline-guided trace. | Research mode records inspected node ids, selected node, opened ranges, fallback hybrid candidate ids, final evidence ids, and reasoning. |
| PI.5 | Done | Admin outline browser and tree-search trace viewer. | Admin can show hierarchy, section paths, page/offset ranges, title-location metadata, summaries, quality metadata, and trace tree-search metadata. |
| PI.6 | Partial | Outline localization evaluation. | `evaluateDocumentOutlineLocalization` exists for section/page hit-rate reporting. |

### M1.2 Remaining Detailed Work

| ID | Priority | Status | Depends On | Task | Implementation Notes | Acceptance | Verification |
|---|---|---|---|---|---|---|---|
| M1.2.1 | P0 | Planned | PI baseline | Strengthen title-on-page verification | Normalize title text, handle whitespace/punctuation/CJK variants, record matched text/page/offset/confidence/source, flag low-confidence matches. | Outline nodes with parser/native/LLM/fallback titles expose reliable `titleLocation` or explicit quality warning. | Unit fixtures for parser heading, native TOC, inferred title, fallback title, missing title, duplicate title. |
| M1.2.2 | P0 | Planned | M1.2.1 | Normalize TOC page offsets | Reconcile native TOC pages, PDF physical pages, parser page numbers, roman numeral front matter, and missing page markers. | `startPage`/`endPage` are deterministic; ambiguous ranges produce quality metadata, not silent wrong citations. | Fixtures for shifted page indexes, front matter, missing pages, and multi-section same-page documents. |
| M1.2.3 | P0 | Planned | M1.2.1 | Validate page/offset range containment | Ensure child outline ranges are within parent ranges, siblings are ordered, and invalid offsets are repaired or flagged. | Outline quality metadata reports range validity, repaired ranges, invalid ranges, and fallback coverage. | Builder tests with overlapping, unordered, and missing offsets. |
| M1.2.4 | P1 | Planned | M1.2.3 | Recursive subdivision for large weak sections | Split large sections with weak structure into deterministic child ranges using headings, paragraph clusters, page boundaries, and token limits. | Long weak sections expose child ranges without replacing raw leaf nodes or breaking source links. | Long-document fixtures with max-token and offset-bound assertions. |
| M1.2.5 | P1 | Planned | M1.2.4 | Improve outline-guided research selection | Use title, summary, section path, candidate leaf hits, and page span to select tighter ranges. | Research traces show fewer irrelevant opened ranges while preserving final evidence recall. | Golden long-document research fixtures. |
| M1.2.6 | P1 | Planned | M1.2.5 | Expand outline evaluation gates | Score section hit rate, page hit rate, title-location hit rate, range containment, selected-node usefulness, and research answer faithfulness. | Eval report can fail a regression when outline localization breaks. | `evaluateDocumentOutlineLocalization` fixture expansion and CI-ready threshold config. |

## 10. Milestone M2: Multimodal Functional Completion

Goal: make table/image/page/code evidence first-class across ingestion, KnowledgeFS,
retrieval, generation, Admin, and evaluation.

### M2.1 Completed Baseline

| ID | Status | Capability | Acceptance Already Met |
|---|---|---|---|
| MM.1 | Done | `DocumentMultimodalManifest` schema and deterministic builder. | Every document can return a manifest, including empty manifests. |
| MM.2 | Done | HTTP and KnowledgeFS read surfaces. | `GET /knowledge-spaces/{id}/documents/{documentId}/multimodal` and `/knowledge/docs/{document}/multimodal.json` work. |
| MM.3 | Done | Metadata normalization. | Tables/images/code/pages carry stable asset refs, bounding boxes, captions, OCR, previews, source metadata, and enrichment statuses. |
| MM.4 | Done | Visual asset extraction/storage. | Embedded data URIs, allowlisted local images, parser paths/URLs, and optional PDF raster outputs can become scoped object-backed assets. |
| MM.5 | Done | Variants and thumbnails. | PDF and non-PDF images can expose thumbnail variants with stable object keys, hashes, dimensions when available, and KnowledgeFS descriptors. |
| MM.6 | Done | Multimodal citation resolution. | Retrieval candidates resolve to manifest item ids, asset descriptor paths, binary routes, page/section/offset, and bounding boxes. |
| MM.7 | Done | Native VLM answer provider support. | VLM-capable providers can receive object-backed image/page attachments as content blocks; text fallback remains available. |
| MM.8 | Done | Visual embeddings. | Text-surrogate and image-byte visual embedding providers can build `visual-asset` projections with metadata linkage. |
| MM.9 | Done | Admin first browser pass. | Document status page shows multimodal summary, detected items, sections/pages, enrichment status, and server-rendered previews. |
| MM.10 | Partial | Evaluation utilities. | Citation localization, understanding keyword/title/status, OCR keyword recall, and visual embedding hit metrics exist. |

### M2.2 Remaining Detailed Work

| ID | Priority | Status | Depends On | Task | Implementation Notes | Acceptance | Verification |
|---|---|---|---|---|---|---|---|
| M2.2.1 | P0 | Planned | MM baseline | Add external chart/table QA fixtures | Commit small but representative fixtures with charts, tables, screenshots, OCR text, expected manifest ids, page/bbox targets, and expected answer facts. | Eval can test chart interpretation, table QA, OCR recall, figure localization, and citation localization. | Multimodal eval runner produces per-mode `fast`, `deep`, `research` metrics. |
| M2.2.2 | P0 | Planned | M2.2.1 | Add multimodal eval gates | Define thresholds for OCR keyword recall, table QA hit rate, chart summary coverage, page hit rate, bbox hit rate, and visual embedding candidate hit rate. | CI or local regression command can detect meaningful multimodal regressions. | Targeted eval tests plus threshold report fixture. |
| M2.2.3 | P1 | Planned | MM baseline | Provider-family conformance tests | Keep generic adapter contracts, then add mocked conformance packs for OCR, VQA/caption, chart summary, table summary, visual embedding, and VLM answer providers. | New provider families can plug in without retrieval/generation schema changes. | Contract tests with success, rate-limit, validation, timeout, partial failure, and stale status cases. |
| M2.2.4 | P1 | Planned | M2.2.3 | Improve provider status surfacing | Normalize failed/stale/skipped/enhanced/provider-budget states across manifest, Admin, trace, and KnowledgeFS descriptors. | Users can distinguish missing asset, provider skipped, provider failed, stale enrichment, and unsupported modality. | Schema/API/Admin tests. |
| M2.2.5 | P1 | Planned | MM baseline | Strengthen visual late-fusion traces | Record textual dense, FTS, OCR/caption, visual vector, graph, and outline contributions separately. | Trace explains why a visual/table item was selected and which retrieval path found it. | Hybrid retrieval trace tests. |
| M2.2.6 | P1 | Planned | M2.2.5 | Admin multimodal trace drill-down | Trace viewer links selected visual/table evidence to thumbnail, asset descriptor, page/bbox, enrichment status, source node, and manifest item. | User can debug multimodal answers without opening raw JSON. | Admin page and BFF route tests. |

## 11. Milestone M3: Admin Integration Honesty

Goal: the Admin Console should never present a control as live if the backing API/BFF
path is missing, preview-only, or using invalid default payloads.

| ID | Priority | Status | Depends On | Task | Details | Acceptance | Verification |
|---|---|---|---|---|---|---|---|
| M3.1 | P0 | Done | Core Admin | Repair upload/readiness/citation live paths | Completed by AIR.1. | Upload, parser checking, citation links, graph, and KnowledgeFS BFF methods use valid API paths. | Existing Admin/API integration tests. |
| M3.2 | P0 | Done | M3.1 | Repair local API base and Compose upstream wiring | Completed by AIR.2. | Source local defaults and Compose Admin upstreams call the expected API service/base URL. | Existing BFF health/upload tests. |
| M3.3 | P0 | Planned | M3.1-M3.2 | Audit remaining preview panels | Cover golden question, annotation, evaluation, Retrieval Studio, diagnostics, outline, multimodal, fsck/gc/operator panels. | Each panel is either live with integration tests or visibly/non-interactively marked preview. | Admin snapshot/page tests and BFF contract tests. |
| M3.4 | P1 | Planned | M1/M2 | Wire outline and multimodal drill-downs | Connect document status, outline browser, multimodal browser, trace tree-search panel, and selected evidence details. | Users can move from document -> outline/multimodal -> query trace -> cited resource without raw JSON pages. | Admin route/page tests. |
| M3.5 | P1 | Planned | M3.3 | Admin action conformance matrix | Document which Admin actions are live, preview, disabled, or planned, with matching tests. | Future UI work cannot accidentally ship false affordances. | Doc + page test guardrail. |

## 12. Milestone M4: API Decomposition and Code Health Closure

Goal: keep `packages/api/src/index.ts` and gateway composition files small, boring, and
focused on wiring.

### M4.1 Completed Remediation Baseline

| Source Item | Status | Result |
|---|---|---|
| R1 | Done | Incremental SSE parser and provider streaming completed. |
| R2 | Done | Structured provider errors, retry/backoff, and abort support completed. |
| R3 | Done | Migration runner, adapter close lifecycle, and health path closure completed. |
| R4 | Done | Command output schema validation completed. |
| R5 | Superseded 2026-07-16 | Resource and diff guardrails retained in TypeScript; the WASM build was removed. |
| R6 | In progress | Many API utilities, repositories, route schemas, handlers, retrieval modules, KnowledgeFS modules, MCP modules, and gateway app pieces extracted. |
| GF.1-GF.5 | Done | Research routes, document write/bulk tests, compilation routes, and gateway test splits partly extracted. |

### M4.2 Remaining Detailed Work

| ID | Priority | Status | Depends On | Task | Acceptance | Verification |
|---|---|---|---|---|---|---|
| M4.2.1 | P0 | Planned | GF.1-GF.5 | Extract document compilation worker tests | Durable worker parse/reindex/publication scenarios live in focused test files; evaluation-gate and failure-path assertions are preserved. | `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/document-compilation-worker.test.ts`. |
| M4.2.2 | P0 | Planned | R6 | Audit residual gateway entrypoint responsibilities | Produce a short list of remaining behavior still defined inline in gateway/index composition files. | `rg`/code-health test proves route definitions, handlers, schemas, and domain helpers stay extracted. |
| M4.2.3 | P1 | Planned | M4.2.2 | Extract residual document/research/KnowledgeFS runtime composition | Move remaining broad behavior into bounded modules while preserving public contracts. | Targeted gateway tests plus code-health guardrails. |
| M4.2.4 | P1 | Planned | M4.2.3 | Plan-to-code traceability guard | Add a lightweight check or documented matrix mapping active plan items to change records/tests. | Major active docs and implementation slices do not drift silently. |

## 13. Milestone M5: Research Mode Functional Completion

Goal: make `research` mode genuinely different from `deep`: it should inspect
structure, choose ranges/resources deliberately, preserve intermediate reasoning, and
produce durable, auditable results.

| ID | Priority | Status | Depends On | Task | Details | Acceptance | Verification |
|---|---|---|---|---|---|---|---|
| M5.1 | P0 | Partial | Existing research tasks + M1 | Outline-first research planning | Dry-run and execution should include outline inspection before expensive retrieval for long-document questions. | Plan shows inspected outlines, estimated tool calls, opened ranges, and fallback strategy. | Research dry-run tests. |
| M5.2 | P0 | Planned | M1/M2 | Multimodal manifest inspection in research | Research planner should inspect manifest counts, pages, figures, tables, and asset availability before opening visual resources. | Research traces include manifest inspection and selected multimodal resources. | Research trace fixtures. |
| M5.3 | P1 | Planned | M5.1-M5.2 | Reasoning tree search scoring | Store why each outline node/range/resource was opened, skipped, or fallbacked. | Trace explains selected sections and visual resources in deterministic metadata. | Trace metadata tests. |
| M5.4 | P1 | Planned | M5.3 | Evidence completion after tree search | After structural range selection, run hybrid retrieval, graph expansion, rerank, and verification only within or around selected ranges unless fallback is needed. | Research results remain high-recall but avoid broad unnecessary scans. | Golden research fixture evaluation. |
| M5.5 | P1 | Planned | Existing research tasks | Durable partial results and replay polish | Ensure research tasks persist partial evidence, selected ranges, command logs, workspace snapshots, and replay metadata. | Interrupted research can resume or explain partial output. | Research task lifecycle tests. |

## 14. Milestone M6: Evaluation Governance

Goal: move quality from ad hoc tests to repeatable regression gates for retrieval,
outline localization, multimodal localization, and research faithfulness.

| ID | Priority | Status | Depends On | Task | Acceptance | Verification |
|---|---|---|---|---|---|---|
| M6.1 | P0 | Planned | M1/M2 | Unified eval report schema | One report can include retrieval recall, citation accuracy, outline localization, multimodal localization, OCR recall, table/chart QA, visual embedding hit rate, and research faithfulness. | Evaluation output is stable and diffable. | Eval schema tests. |
| M6.2 | P0 | Planned | M6.1 | Golden fixture set | Add small fixtures for text docs, long docs, tables, charts, scanned/OCR docs, image-heavy PDFs, and multi-hop research. | Fixtures cover fast/deep/research. | Fixture runner tests. |
| M6.3 | P1 | Planned | M6.2 | CI threshold profiles | Define local, PR, and release threshold profiles. | Severe regressions fail PR/release checks while local dev remains usable. | CI command or scripted threshold tests. |
| M6.4 | P1 | Planned | M6.3 | Admin evaluation visibility | Admin can show eval pass rate, failing examples, trace links, and strategy comparison. | Human operators can diagnose regressions from UI. | Admin page tests. |

## 15. Historical Phase Library

The original 6-phase plan remains valid as an architectural library. Future work should
pull from it only when it aligns with the active milestones above.

| Phase | Original Focus | Current Relationship |
|---|---|---|
| Phase 1: Foundation | Monorepo, gateway, schema, parsers, chunker, basic retrieval, KnowledgeFS, MCP, evaluation MVP. | Core foundation is largely implemented. Use only for contract checks and missing baseline tests. |
| Phase 2: Production Retrieval | Hybrid recall, rerank, EvidenceBundle, permission, generation, KnowledgeFS tools, Admin UI, CI regression. | Most relevant pieces are already implemented or folded into M3/M5/M6. |
| Phase 3: Durable Ingestion | JobQueue, versioned ingestion, blue-green publish, parser router, bulk operations, lifecycle. | Durable local/runtime and hardening are mostly complete; revisit only for production workflow gaps. |
| Phase 4: Advanced Compiler | Enrichment, summary tree, graph, semantic views, structured retrieval, image/OCR, diff, verification. | Active work now centers on PageIndex outlines and multimodal completion. |
| Phase 5: Agent Research | Research lifecycle, snapshots, source comparison, conflict, freshness, backpressure, A2A. | Folded into M5; A2A remains deferred. |
| Phase 6: Evaluation Platform | Golden UI, auto question generation, advanced metrics, A/B, annotation, diagnostics. | Folded into M6; prioritize regression fixtures before broad UI expansion. |

## 16. Deferred Scope

Do not prioritize these until the functional milestones above are complete or a
specific user need makes them necessary:

- new safety/quota layers beyond existing document-level extraction limits,
  object-key scoping, and provider budget metadata;
- provider token/currency budget enforcement backed by tenant budget policy;
- optional WebDAV/FUSE adapter;
- Temporal workflow adapter;
- dedicated search/vector/graph backend outside the database-as-search-engine model;
- broad A2A expansion beyond isolated adapter skeletons;
- provider marketplace breadth that does not improve current outline/multimodal/research
  quality.

## 17. Verification Matrix

Use the narrowest meaningful checks for each slice, then run broader checks before
release-level merges.

| Work Area | Required Focused Checks | Broader Checks When Relevant |
|---|---|---|
| Documentation | `git diff --check`, `rg` contract/source references. | Markdown link/path review. |
| PageIndex outline | Outline builder/repository/API/KnowledgeFS tests, localization eval tests. | API typecheck, Admin outline tests, retrieval trace tests. |
| Multimodal | Manifest builder/API/KnowledgeFS tests, asset extraction/raster/variant tests, visual embedding tests, multimodal eval tests. | Admin browser tests, hybrid retrieval tests, provider adapter tests. |
| Admin | Admin unit/page tests, BFF integration tests. | `pnpm --filter @knowledge/admin typecheck`, API BFF tests. |
| API/code health | Code-health tests, targeted gateway/domain tests. | `pnpm --filter @knowledge/api typecheck`, `pnpm check`. |
| Research | Research dry-run/task/trace tests, MCP tests. | E2E research fixture tests. |
| Release-level | Targeted checks above. | `pnpm check`, `pnpm build`, `pnpm lint`, compute package tests if algorithms changed, Docker/Compose checks if packaging changed. |

## 18. Working Rules

- Update this file when a planned item becomes done or changes priority.
- Add a dated `.harness/changes` record for each completed slice.
- Keep old source plans as records; do not erase historical details to make the
  current plan look cleaner.
- Prefer small independently useful slices.
- Commit and push after each completed task.
- If implementation reveals that a planned item is already complete, verify it with
  tests or code inspection, update its status, and record the reason.

## 19. Immediate Next Slice

The next functional implementation slice should be:

1. `M0.5.2.1` dataset list and create flows, because the prototype makes datasets the
   primary product entry point.
2. `M0.5.2.2` dataset detail shell, so every later surface has the correct route,
   navigation, and dataset metadata container.
3. `M0.5.2.3` overview readiness aggregator, so the product can explain whether a
   knowledge base is usable before users open lower-level tools.
4. `M0.5.2.4` sources provider workflow, because source freshness and sync failures are
   first-class in the prototype.
5. `M0.5.2.5` documents workspace, to expose parser/index/projection status and
   document-level repair actions.
6. Continue through Evidence, Quality, Settings/API, Agent Access, and Pipeline before
   returning to PageIndex/multimodal quality-only hardening.

Recommended order:
`M0.5.2.1 -> M0.5.2.2 -> M0.5.2.3 -> M0.5.2.4 -> M0.5.2.5 -> M0.5.2.6 -> M0.5.2.7 -> M0.5.2.8 -> M0.5.2.9 -> M0.5.2.10 -> M0.5.2.11 -> M1.2.1 -> M1.2.2 -> M2.2.1 -> M2.2.2 -> M3.3 -> M4.2.1`.
