# Image Query Retrieval Iteration Plan

> Created: 2026-08-07
> Status: Proposed
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

This plan closes the four gaps that keep an image from being a first-class query input:

1. **IQ1** — query-side image visual embedding (image-to-image / image-to-visual-asset search);
2. **IQ2** — gateway schema and transport for query images;
3. **IQ3** — attaching query images to VLM answering;
4. **IQ4** (decision-gated) — converting the query image to text so conventional legs
   (FTS, text dense, rerank, page-index) can participate for pure-image queries.

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
- All image byte caps are validated **before** base64 decode/buffering; requests exceeding caps
  fail with typed 400 errors, never with allocation.
- Query image MIME allowlist is `image/png`, `image/jpeg`, `image/webp`, `image/gif` — matching
  the formats whose dimensions the ingest asset extractor can already parse. SVG is never accepted.
- Request schemas stay `.strict()`; new fields are optional so existing clients are unaffected.
- `api/knowledge-fs-contract.lock.json` is refreshed exactly once (IQ2), not per slice.
- Degradation is typed and observable: an image the pipeline cannot use produces a reason code on
  the trace/SSE stream, never a silent drop and never a hard failure of the text portion.
- Query image bytes are not persisted in v1; traces record `{sha256, byteSize, mimeType, count}`
  only. (Replay limitation documented; revisit if trace replay needs the pixels.)
- Behavioral work follows RED -> GREEN -> REFACTOR and keeps package coverage at or above 90%.
- No internal scheduling values exposed as end-user relevance scores.

## 4. Prerequisites and Assumptions

- The visual embedding provider must be enabled and the target space must already hold
  `visual_vector` projections for the visual leg to return anything. Spaces without a visual index
  degrade with a typed reason (see IQ0), they do not error.
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

1. Transport is **inline base64 in the request body** for v1:
   `queryImages: [{ data: <base64>, mimeType }]`, max 4 images, max 10 MB decoded per image
   (aligned with the enrichment default `maxImageBytes`), with a request-level cap accounting for
   ~1.37x base64 inflation. Rationale: query images are ephemeral, so inline transport avoids
   upload-session storage lifecycle/GC questions entirely. The alternative (upload-session file
   reference) is recorded for a future revision if payload sizes demand it.
2. Mode matrix: the visual leg with an image-derived vector runs in **all** modes (it is one
   bounded vector search); IQ4 image-to-text expansion runs in **deep/research only**.
3. When both text and image are present, the image-derived vector owns the visual leg (the image
   is the stronger signal for the visual space); text keeps all its existing legs. No change to
   text-leg behavior.
4. Degradation reason codes (extending the existing typed-degradation convention):
   `query-image-visual-leg-unavailable` (no visual provider / no visual index),
   `query-image-ignored-no-vision-model` (IQ3/IQ4 capability missing),
   `query-image-expansion-timeout` (IQ4 guard fired).
5. Trace metadata shape for query images (hash/size/mime/count; no bytes).

Tasks:

1. Record the decisions above in this plan and in `docs/api-reference.md` draft form.
2. Define zod validators for `queryImages` with byte/count/MIME caps as pure, unit-testable
   functions.
3. Define the degradation reason codes and their SSE/trace surfaces.
4. Add this plan to the consolidated execution index.

Acceptance:

- Validators reject oversized, over-count, and disallowed-MIME payloads in unit tests without
  decoding image bytes.
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
- `apps/api/src/retriever-options.ts`: when the retrieval context carries query images, run the
  visual leg with the image-derived vector **regardless of the configured
  `KNOWLEDGE_VISUAL_EMBEDDING_QUERY_MODE`** (`fallback` semantics only make sense for
  text-to-visual; an explicit image must always be searched). Text-derived visual querying stays
  unchanged when no image is present.
- Fusion: image-leg candidates enter the existing RRF/boost fusion exactly like today's visual-leg
  candidates; candidate enrichment via `document-multimodal-candidate-resolver.ts` is unchanged
  (image-node candidates carry caption/ocrText into final rerank via their text, so the text-only
  reranker still works).
- No visual index / no provider: emit `query-image-visual-leg-unavailable`, continue with text
  legs.

Tasks:

1. Parameterize embedding input type; add query-image embed path with its own byte cap reuse.
2. Thread query images into the retriever context and visual-leg vector selection.
3. Unit tests: `input_type: "query"` reaches the client payload; visual leg runs with image vector
   under `fallback` and `off` query modes when an image is present; typed degradation when the
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

- Add optional `queryImages` (IQ0 shape) to `QueryStreamRequestSchema`
  (`gateway-route-schemas.ts`) and to the research-task request schemas
  (`research-task-request-schemas.ts`) so interactive and durable paths accept the same input.
- Enforce IQ0 validators in the route layer before any decode; decoded bytes flow into the
  retrieval context created by the query handlers.
- Record trace metadata (hash/size/mime/count) on the AnswerTrace; surface degradation reason
  codes as SSE events.
- Refresh `api/knowledge-fs-contract.lock.json`; update `docs/api-reference.md` and the operator
  manual (caps, allowlist, degradation codes).

Tasks:

1. Schema + validators wired into `query-routes.ts` / research task routes.
2. Context threading through gateway handlers into retriever/answer stages.
3. Contract lock refresh and docs.
4. Route tests: optional-field backward compatibility; 400s for each cap violation; a streamed
   answer for a valid image query against a seeded space; research-task acceptance of the same
   payload.

Acceptance:

- Existing clients (no `queryImages`) see identical responses.
- Invalid payloads fail with typed 400s and zero image-byte allocation.
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
- Query images count toward the existing cumulative byte budget and `maxImageAttachments` (default
  8) with precedence over evidence images: budget exhaustion drops evidence images first, query
  images last.
- If the request carries images but the multimodal answer provider is absent or the model lacks
  vision, emit `query-image-ignored-no-vision-model` and answer text-only — retrieval performed in
  IQ1/IQ2 is unaffected.

Tasks:

1. Provider input extension + prompt assembly ordering.
2. Budget precedence implementation and tests.
3. Degradation event on missing provider/capability.

Acceptance:

- Prompt-order and budget-precedence unit tests pass (query image survives budget pressure;
  evidence images are shed first).
- Text-only fallback emits the typed reason and still streams a grounded answer.

---

### IQ4 — Query image-to-text expansion for deep/research

Priority: P2 — decision-gated; do not build before the gate below.

**Why.** A pure-image query can only reach nodes that carry a `visual_vector`, and those exist
only for image-asset projections — text chunks are unreachable. Converting the **user's single
query image** into text (description + OCR + keywords) lets FTS, text dense, rerank, and
page-index legs participate. This is categorically different from the rejected
per-evidence-image recognition: one bounded VLM call on the user's own input, not N repeated
calls over retrieved documents.

**Why gated.** It adds a VLM round-trip (typically 1–5 s) to deep/research latency, and its value
depends on how often image queries actually target textual content. Gate: after IQ1–IQ3 have been
in production, review failed-query clustering and golden-question results for image-bearing
queries; build IQ4 only if pure-image or mixed queries measurably miss text evidence.

**Approach (when green-lit).**

- Run in the query-generation stage (`hybrid-query-generator.ts` /
  `llm-answer-query-generator.ts` area) for deep/research only; fast mode never invokes it.
- One structured vision-LLM call producing `{description, ocrText, keywords}`; merge into the
  text query fed to conventional legs. Capability check reuses the catalog preflight
  (`features` contains `vision`).
- Hard timeout (default 8 s, env-tunable) with fail-open: on timeout/error, continue with the
  visual leg only and emit `query-image-expansion-timeout`.
- Expansion output is recorded on the trace for explainability.

Acceptance:

- Timeout guard and fail-open behavior covered by tests; fast mode provably never calls the VLM.
- Deep-mode latency budget documented with measured expansion overhead.

## 6. Sequencing

IQ0 → IQ1 → IQ2 → IQ3 → (evaluation gate) → IQ4.

IQ1 precedes IQ2 so the embedding path is proven in unit tests before any contract churn; the
contract lock changes once, in IQ2. IQ3 is independent of IQ4 and ships as soon as IQ2 lands.

## 7. Verification

- Per-slice unit tests as listed; retrieval-test routes gain an image-query fixture in IQ2.
- Regression: text-only query snapshots must remain unchanged through every slice.
- Post-IQ3, extend the multimodal evaluation suite with query-side cases (image query citation
  correctness) as the regression gate before considering IQ4.
