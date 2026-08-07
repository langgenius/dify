# Image Query Retrieval Iteration Plan

> Created: 2026-08-07
> Status: Implemented 2026-08-07
> Scope: KnowledgeFS backend, backend tests, contracts, and documentation only. No frontend changes.

## 1. Decision Summary

Retrieval currently accepts text-only queries (`QueryStreamRequestSchema.query: z.string()`,
`gateway-route-schemas.ts:93`, `.strict()`), while the backend already carries most of the
multimodal machinery an image query needs:

- The model-runtime client's `invokeMultimodalEmbedding` already accepts
  `inputType: "document" | "query"` and image documents
  (`packages/dify-model-runtime-client/src/index.ts:4,39`); KnowledgeFS only ever calls it with
  `"document"` at ingest. Dify's inner API passes `input_type` through to the model instance
  unchanged. Embedding a **query image** into the existing visual vector space is the same
  endpoint with a different input type — no Dify-side change required.
- The visual retrieval leg (`searchVisualDense`, `hybrid-retrieval.ts:228`) searches the
  `visual_vector` column and takes an arbitrary query vector. Today that vector always comes from
  **text** embedded on the multimodal model (`visual-embedding-options.ts` `queryEmbeddingProvider`,
  mirroring Dify's `embed_query` for multimodal datasets). The leg is text-to-image only.
- The VLM answer provider already builds `image_url` content blocks from object-storage-backed
  evidence images with a cumulative byte budget (`llm-multimodal-answer-provider.ts`). It has no
  notion of a user-supplied query image.

This plan closes the four gaps that keep an image from being a first-class query input. Text and
images are **alternative query modalities**: a request must contain at least one non-empty
`query` or one `queryImages` entry, and may contain both when the caller intentionally wants a
multimodal query.

The four delivery slices are:

1. **IQ1** — query-side image visual embedding (image-to-image / image-to-visual-asset search);
2. **IQ2** — gateway schema and transport for query images;
3. **IQ3** — attaching query images to VLM answering;
4. **IQ4** — converting the query image to text so conventional legs (FTS, text dense, rerank,
   PageIndex) can participate. This is optional for Fast, but required for a pure-image Research
   query because Research must navigate the document tree rather than silently become a flat
   visual search.

## 2. Explicit Non-Goals

- **No retrieval-time VLM recognition of retrieved document images.** Decided against: the
  recognition result is a property of the document, not the query; per-query recognition repeats
  the same VLM cost on every request, and its text arrives too late to drive candidate discovery
  (retrieval finds candidates from indexed projections). The correct home for that capability is
  ingest-side enrichment plus incremental reindex of image nodes, tracked separately.
- **No capability-derived auto-enabling of multimodal providers.** Replacing the
  `KNOWLEDGE_VISUAL_EMBEDDING_* / _ENRICHMENT_* / _ANSWER_*` env sets with space-model-config +
  capability-preflight derivation (Dify marks vision support via `ModelFeature.VISION` on both LLM
  and text-embedding schemas; `api/core/model_manager.py:561`) is a separate track. This plan
  assumes providers are configured by whichever mechanism is current.
- **No ingest-side enrichment reindex work** (caption/ocrText back into fts/dense projections,
  no-text image nodes). Referenced as the companion track; not in scope here.
- **No Admin Console image-upload UI.** Backend and contracts only; Admin retrieval-test UI is a
  follow-up.
- **No audio/video query modalities.**

## 3. Guardrails

- Every read stays bound to the immutable publication snapshot and server-issued permission scope.
- Browser-facing requests carry Dify `UploadFile` references, never inline base64. Dify validates
  tenant/actor ownership, MIME, per-image size, count, and aggregate size before issuing the
  KnowledgeFS capability. KnowledgeFS resolves bytes through an authenticated Dify inner API and
  bounds the response while streaming it into memory.
- Query image MIME allowlist is `image/png`, `image/jpeg`, `image/webp`, `image/gif` — matching
  the formats whose dimensions the ingest asset extractor can already parse. SVG is never accepted.
- Request schemas stay `.strict()`; new fields are optional so existing clients are unaffected.
- `api/knowledge-fs-contract.lock.json` is refreshed after the complete reviewed change set. The
  subtree hash necessarily changes whenever KnowledgeFS production files change; CI must never be
  bypassed by pinning an intermediate hash.
- Degradation is typed and observable: an image the pipeline cannot use produces a reason code on
  the trace/SSE stream, never a silent drop and never a hard failure of the text portion.
- Query image bytes are not duplicated in KnowledgeFS. Durable Research jobs persist immutable
  Dify upload-file references and the derived expansion text; traces record
  `{uploadFileId, sha256, byteSize, mimeType}` only. This makes retry/replay deterministic while
  retaining Dify's unified object-storage lifecycle.
- Behavioral work follows RED -> GREEN -> REFACTOR and keeps package coverage at or above 90%.
- No internal scheduling values exposed as end-user relevance scores.

## 4. Prerequisites and Assumptions

- The visual embedding provider must be enabled and the target space must already hold
  `visual_vector` projections for the visual leg to return anything. Spaces without a visual index
  degrade with a typed reason (see IQ0), they do not error.
- Query-image visual retrieval is controlled by its own feature flag and also requires the visual
  query provider and a visual index. It does not override an operator's explicit `off` setting.
- IQ3 requires the multimodal answer provider; IQ4 requires a vision-capable LLM on the space.
  Capability checks reuse the existing model-capability catalog/preflight
  (`capabilities.features` containing `vision`).

## 5. Iterations

### IQ0 — Contracts and decisions

Priority: P0

**Why.** The transport shape constrains every later slice and the contract lock should churn once.
Fixing the degradation vocabulary first keeps IQ1–IQ4 individually shippable: each slice can lean
on "emit reason code X" instead of inventing ad-hoc behavior.

**Approach / decisions to ratify.**

1. Transport is an immutable Dify file reference:
   `queryImages: [{ uploadFileId: <uuid> }]`, max 4 images, max 10 MiB per image and max 32 MiB in
   aggregate. The existing upload API owns bytes and storage; Dify validates the referenced files
   before admission and KnowledgeFS resolves them through a bounded inner API.
2. `query` is optional and `queryImages` is optional, but the request-level invariant is
   **non-empty query OR at least one image**. Both are accepted. No placeholder or OCR text is
   written into the user-query field.
3. Mode matrix: the visual leg with an image-derived vector runs in Fast/Deep and may seed
   Research. Image-to-text expansion runs in Deep/Research; Research then performs bounded,
   level-by-level PageIndex traversal and a final LLM synthesis.
4. When both text and image are present, the image-derived vector owns the visual leg (the image
   is the stronger signal for the visual space); text keeps all its existing legs. No change to
   text-leg behavior.
5. Multiple query images are searched independently and fused with equal-weight RRF. Their
   vectors are never averaged because averaging destroys distinct visual intents.
6. Degradation reason codes (extending the existing typed-degradation convention):
   `query-image-visual-leg-unavailable` (no visual provider / no visual index),
   `query-image-ignored-no-vision-model` (IQ3/IQ4 capability missing),
   `query-image-expansion-timeout` (IQ4 guard fired).
7. Trace metadata shape for query images (Dify reference/hash/size/mime; no bytes).

Tasks:

1. Record the decisions above in this plan and in `docs/api-reference.md` draft form.
2. Define zod validators for `queryImages` references and Dify-side ownership/MIME/size validators
   as pure, unit-testable functions.
3. Define the degradation reason codes and their SSE/trace surfaces.
4. Add this plan to the consolidated execution index.

Acceptance:

- Validators reject unknown/foreign, oversized, over-count, aggregate-over-limit, malformed, and
  disallowed-MIME references before model or retrieval work starts.
- Reason codes are defined in one module consumed by later slices.

---

### IQ1 — Query-side image visual embedding

Priority: P0

**Why first.** It is the smallest change that makes an image query real, and it is fully
unit-testable without touching the public API surface: the client already supports
`inputType: "query"`, and `searchVisualDense` already accepts any vector. Everything downstream
(IQ2 transport, IQ3 answering) becomes verifiable end-to-end once this exists.

**Approach.**

- `apps/api/src/visual-embedding-options.ts`: the image-bytes provider currently hardcodes
  `inputType: "document"` in `embedImages`. Parameterize the input type and expose a
  query-image embedding function on `ApiVisualEmbeddingOptions` that embeds raw query image bytes
  (not object-storage-backed assets) with `inputType: "query"` on the same
  model/pluginId/provider selection.
- `apps/api/src/retriever-options.ts`: when the retrieval context carries query images and the
  dedicated feature flag plus visual query provider are enabled, run one visual search per image.
  Honor `KNOWLEDGE_VISUAL_EMBEDDING_QUERY_MODE=off`; explicit operator disablement is authoritative.
  Text-derived visual querying stays unchanged when no image is present.
- Fusion: image-leg candidates enter the existing RRF/boost fusion exactly like today's visual-leg
  candidates; candidate enrichment via `document-multimodal-candidate-resolver.ts` is unchanged
  (image-node candidates carry caption/ocrText into final rerank via their text, so the text-only
  reranker still works).
- No visual index / no provider: emit `query-image-visual-leg-unavailable`, continue with text
  legs.

Tasks:

1. Parameterize embedding input type; add query-image embed path with its own byte cap reuse.
2. Thread query images into the retriever context and visual-leg vector selection; fuse multiple
   image result lists with equal-weight RRF.
3. Unit tests: `input_type: "query"` reaches the client payload; visual leg runs with image vector
   under enabled `fallback`/`primary` query modes when an image is present; no model call under
   `off`; typed degradation when the
   provider or index is absent; text-only requests behave byte-identically to today.

Acceptance:

- With a seeded visual index, an image query returns visual-leg candidates with correct fusion
  ordering in tests.
- No behavior change for text-only queries (snapshot/regression tests pass unmodified).

---

### IQ2 — Gateway schema and transport

Priority: P0

**Why.** The only user-visible gap: `.strict()` schemas reject any image field today. Lands after
IQ1 so the route change ships already wired to a working retrieval path.

**Approach.**

- Make `query` optional, add optional `queryImages` (IQ0 shape), and enforce the at-least-one
  invariant in `QueryStreamRequestSchema`
  (`gateway-route-schemas.ts`) and to the research-task request schemas
  (`research-task-request-schemas.ts`) so interactive and durable paths accept the same input.
- Dify validates references before capability admission. KnowledgeFS resolves the references via
  the authenticated inner endpoint before opening the SSE stream; bounded bytes flow into the
  retrieval context created by the query handlers.
- Record trace metadata (hash/size/mime/count) on the AnswerTrace; surface degradation reason
  codes as SSE events.
- Refresh `api/knowledge-fs-contract.lock.json`; update `docs/api-reference.md` and the operator
  manual (caps, allowlist, degradation codes).

Tasks:

1. Schema + validators wired into `query-routes.ts` / research task routes.
2. Context threading through gateway handlers into retriever/answer stages.
3. Dify UploadFile resolver + inner endpoint, contract lock refresh, and docs.
4. Route tests: optional-field backward compatibility; 400s for each cap violation; a streamed
   answer for a valid image query against a seeded space; research-task acceptance of the same
   payload.

Acceptance:

- Existing clients (no `queryImages`) see identical responses.
- Invalid or foreign file references fail with typed 400/404 responses and no model invocation.
- End-to-end: image-only and text+image queries stream answers with visual-leg evidence.

---

### IQ3 — Query images in VLM answering

Priority: P1

**Why.** The answer stage is the one place where query-time vision adds value no ingest-time work
can replace: the model reads the user's own image in the context of the question. The provider
already assembles evidence-image content blocks with a cumulative byte budget; this slice only
adds the user's images to that assembly.

**Approach.**

- Extend the multimodal answer provider input with query images; order them **before** evidence
  images in the prompt (the question's subject should anchor the context).
- Research query images count toward the existing cumulative byte budget and
  `maxImageAttachments` (default
  8) with precedence over evidence images: budget exhaustion drops evidence images first, query
  images last.
- Fast and Deep never invoke the answer LLM. Research attaches query images to the final VLM
  synthesis. If that provider is absent or lacks vision, emit
  `query-image-ignored-no-vision-model` and synthesize from the derived text/evidence; retrieval is
  unaffected.

Tasks:

1. Provider input extension + prompt assembly ordering.
2. Budget precedence implementation and tests.
3. Degradation event on missing provider/capability.

Acceptance:

- Prompt-order and budget-precedence unit tests pass (query image survives budget pressure;
  evidence images are shed first).
- Text-only fallback emits the typed reason and still streams a grounded answer.

---

### IQ4 — Query image-to-text expansion for Deep/Research

Priority: P1 for pure-image Research; P2 for optional Deep quality improvements.

**Why.** A pure-image query can only reach nodes that carry a `visual_vector`, and those exist
only for image-asset projections — text chunks are unreachable. Converting the **user's single
query image** into text (description + OCR + keywords) lets FTS, text dense, rerank, and
page-index legs participate. This is categorically different from the rejected
per-evidence-image recognition: one bounded VLM call on the user's own input, not N repeated
calls over retrieved documents.

**Why required for Research.** It adds a bounded VLM round-trip, but a pure-image Research request
has no semantic text with which to choose documents or navigate title/summary nodes. Without it,
calling the mode `research` would be misleading. Deep may fail open to visual-only retrieval.

**Approach (when green-lit).**

- Run in the query-generation stage (`hybrid-query-generator.ts` /
  `llm-answer-query-generator.ts` area) for deep/research only; fast mode never invokes it.
- One structured vision-LLM call producing `{description, ocrText, keywords}`; merge into the
  text query fed to conventional legs. Capability check reuses the catalog preflight
  (`features` contains `vision`).
- Hard timeout (default 8 s, env-tunable) with fail-open: on timeout/error, continue with the
  visual leg only and emit `query-image-expansion-timeout`.
- Persist expansion output on a durable Research job so retry does not repeat the VLM call. Record
  only derived text and image metadata on the trace.
- For Research, use the expansion plus any supplied query text for document selection, then perform
  bounded **level-by-level** PageIndex traversal (the book-reading behavior), followed by at most
  one bounded supplementary search and final LLM synthesis.
- Pure-image Research fails with a typed capability error when no vision model can produce the
  navigation query; it must not silently return an empty tree result or masquerade as Research.

Acceptance:

- Timeout guard and fail-open behavior covered by tests; fast mode provably never calls the VLM.
- Deep-mode latency budget documented with measured expansion overhead.

## 6. Sequencing

IQ0 → IQ1 → IQ2 → IQ4 (Research-required subset) → IQ3 → optional Deep tuning.

IQ1 precedes IQ2 so the embedding path is proven in unit tests before the public contract changes.
IQ4 precedes the Research answer attachment because it establishes a valid PageIndex navigation
query. The contract lock is refreshed only after all reviewed production changes are present.

## 7. Verification

- Per-slice unit tests as listed; retrieval-test routes gain an image-query fixture in IQ2.
- Regression: text-only query snapshots must remain unchanged through every slice.
- Post-IQ3, extend the multimodal evaluation suite with query-side cases (image query citation
  correctness) as the regression gate before considering IQ4.

## 8. Implementation Result

- IQ0–IQ4 are implemented for the backend-only scope. `query` and `queryImages` are alternative
  modalities with an at-least-one invariant and support for intentional mixed queries.
- Dify validates actor-owned UploadFile references and serves bounded bytes through an authenticated
  inner endpoint; KnowledgeFS persists no duplicate image bytes.
- Fast/Deep can perform independently fused image-to-visual searches behind the opt-in feature flag.
  Fast remains free of vision-LLM expansion. Deep and Research perform one bounded expansion, and
  durable Research checkpoints it for retry/replay.
- Pure-image Research routes to Research under Auto, uses the expansion for document selection and
  the existing level-by-level PageIndex path, and performs final synthesis. Missing capabilities
  fail or degrade with the typed reasons defined in IQ0.
- Query image metadata reaches EvidenceBundle and AnswerTrace without raw bytes. Dry-run estimates
  and durable cost accounting include the image-expansion model call.
- Verification evidence and changed-file scope are recorded in
  `.harness/changes/2026-08-07-image-query-retrieval.md`.
