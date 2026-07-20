# Failed-Query → Golden-Question Loop — Design & Iteration Plan

Date: 2026-07-06

## Goal

Close the loop from production retrieval misses to the evaluation set. When a query fails to produce
an answer, decide **why** it failed and route it correctly:

- **Relevant to the corpus but the answer exists and retrieval missed it** → a *retrieval miss* →
  after human annotation, promote to a **golden question** (with expected evidence). This is the
  valuable case that hardens retrieval.
- **Topically relevant but the answer is genuinely absent** → a *coverage gap* → a "known gap"
  signal that we should ingest more documents. NOT a golden question.
- **Out of scope** → discarded, not a failed query.

## Why the naive version is wrong (design principles)

The original idea — "empty results + is-it-relevant → failed query → golden question" — has four
traps this plan fixes:

1. **Don't judge relevance with the signal that just failed.** If chunk retrieval returned nothing,
   re-checking relevance with the *same* embedding masks embedding-mismatch misses. Relevance must be
   judged with an **independent, coarser** oracle: document/section **summaries**, the **graph**
   (entity/alias overlap, community summaries) — all of which we already build during ingestion.
2. **"Empty" is too narrow a trigger.** Hybrid retrieval rarely returns literally zero; the common
   failure is "returned low-relevance junk" or "retrieved but the generator couldn't answer". Trigger
   on the structured abstention signal, not only empty retrieval.
3. **Don't conflate retrieval-miss with coverage-gap.** A golden question implies an answer exists.
   Promoting coverage gaps to golden questions manufactures permanently-failing eval items. Triage
   must split these.
4. **Operational hygiene.** Triage runs **async** (not the query hot path), failed queries are
   **deduped/clustered** (one gap = one annotation, not 50 paraphrases), the relevance gate is
   **precision-oriented**, and the loop only pays off if golden questions **gate** retrieval changes.

## What already exists (hook points, confirmed)

- **Trigger signal**: both generators emit a structured done event with
  `finishReason: "no-retrieval-evidence"` on empty retrieval
  (`hybrid-query-generator.ts:110`, `llm-answer-query-generator.ts:135`); the answered path uses
  `"retrieval-evidence"`. There is **no** structured signal for "retrieved but insufficient" — only a
  free-text prompt instruction (`llm-answer-query-generator.ts:67`). → Phase 1 adds it.
- **`AnswerTrace`** (`models.ts:1058`): `{knowledgeSpaceId, query, mode, steps[], evidenceBundleId?}`
  — the natural record to link a failed query to.
- **`GoldenQuestion`** (`models.ts:1037`): `{question, expectedEvidenceIds[], tags[], metadata}` — no
  status field, so failed-query lifecycle needs its own model. `GoldenQuestionRepository` +
  `registerGoldenQuestionHandlers` already exist to receive promotions.
- **Relevance oracles (independent + coarse)**: outline/section `summary`
  (`DocumentOutline`, `models.ts:613`), graph **community summaries**
  (`llm-community-summary-provider.ts` / `semantic-community-materializer.ts`), and knowledge-graph
  **nodes with aliases** (entity match). Retrieval is hybrid dense/fts/visual + rerank + fusion.

## Data model (new)

`FailedQuery`:
- `id`, `knowledgeSpaceId`, `createdAt`, `updatedAt`
- `query`, `mode`, `answerTraceId?`
- `trigger`: `"no-retrieval-evidence" | "low-confidence" | "abstained"`
- `status`: `"pending-triage" | "triaged" | "pending-annotation" | "annotated" | "dismissed" | "promoted"`
- `clusterId?` (dedup)
- `triage?`: `{ verdict: "irrelevant" | "retrieval-miss" | "coverage-gap" | "uncertain",
  confidence: number, signals: { summaryMatch?, entityOverlap?, judge? }, triagedAt }`
- `annotation?`: `{ verdict, expectedEvidenceIds?[], goldenQuestionId?, note?, annotatedBy, annotatedAt }`

Status machine: `pending-triage` → (triage) `triaged`
→ `irrelevant` ⇒ `dismissed`; `retrieval-miss` / `coverage-gap` ⇒ `pending-annotation`
→ (annotate) `retrieval-miss` ⇒ promote golden question ⇒ `promoted`; `coverage-gap` ⇒ `annotated`
(known-gap); `irrelevant` ⇒ `dismissed`.

Tenant/space scoping mirrors every other repo (scoped by `knowledgeSpaceId`, tenant enforced via
`spaces.get`). Failed-query text is user data → same tenant isolation as answer traces.

## Iteration slices (each: tests + its own commit)

### Phase 0 — Failed-query capture (async, no triage yet)
- `FailedQuerySchema` + `FailedQueryRepository` (in-memory + DB). New `failed_queries` table
  (schema.ts + rendered migrations under the drift test).
- Capture: at the query handler, when the generator's done event `finishReason ===
  "no-retrieval-evidence"`, enqueue/record a `FailedQuery{status:"pending-triage",
  trigger:"no-retrieval-evidence", answerTraceId}`. Off the hot path (fire-and-forget / job), never
  blocks the response.
- Read API: `GET /knowledge-spaces/{id}/failed-queries` (bounded, filter by status).
- Accept: an empty-retrieval query lands a pending-triage FailedQuery; answered queries do not.

### Phase 1 — Structured abstention signal (broaden the trigger)
- Add a structured "insufficient evidence" outcome to the LLM answer path: detect abstention
  (evidence retrieved but the model declined) and emit `finishReason: "insufficient-evidence"` +
  a top-fused-score below a configurable floor → `trigger:"low-confidence"|"abstained"`.
- Capture these in Phase 0's recorder.
- Accept: a query that retrieves junk and abstains is captured; a well-answered query is not.

### Phase 2 — Relevance triage (the core; independent, coarse oracle)
- `RelevanceTriage` service (async worker), producing `{verdict, confidence, signals}`:
  1. **Summary-level match** — embed the query, cosine vs **document/section summary** embeddings
     (a coarse index separate from chunks). Any hit above threshold ⇒ topically relevant.
  2. **Graph entity overlap** — extract query entities, match against knowledge-node names/aliases +
     community summaries. Overlap ⇒ relevant.
  3. **Answerability check** (only when 1/2 say relevant) — an LLM judge over the corpus ToC / top
     summaries decides *retrieval-miss* (answer appears to exist → should have retrieved it) vs
     *coverage-gap* (relevant topic, no supporting evidence anywhere). Precision-oriented; default to
     `uncertain` rather than over-claiming.
  - Verdict: no summary + no entity + judge out-of-scope ⇒ `irrelevant`; relevant + evidence-exists ⇒
    `retrieval-miss`; relevant + no-evidence ⇒ `coverage-gap`.
- `irrelevant` ⇒ auto-`dismissed`; others ⇒ `pending-annotation`.
- Accept: an in-corpus query whose answer exists but was missed ⇒ `retrieval-miss`; an off-topic query
  ⇒ `irrelevant` (auto-dismissed); a relevant-but-absent query ⇒ `coverage-gap`.

### Phase 3 — Dedup / clustering
- Cluster semantically-similar pending failed queries (embedding + threshold, or canonicalization)
  into `clusterId`, so annotation reviews one representative per gap. Cluster size becomes a priority
  signal (frequent gaps first).
- Accept: N paraphrases of one gap collapse to one cluster with count N.

### Phase 4 — Annotation & promotion
- `PATCH /knowledge-spaces/{id}/failed-queries/{id}` annotation surface: reviewer confirms the triage
  verdict and, for `retrieval-miss`, attaches `expectedEvidenceIds` (the passages that *should* have
  been retrieved) → **promote to a golden question** via the existing `GoldenQuestionRepository`
  (question = the failed query, expectedEvidenceIds set), status ⇒ `promoted`, back-linked.
- `coverage-gap` ⇒ recorded as a known gap (no golden question); `irrelevant` ⇒ `dismissed`.
- Accept: annotating a retrieval-miss creates a golden question with expected evidence and links back.

### Phase 5 — Close the loop (eval + remediation)
- Golden questions run in an **eval harness** that gates retrieval/index changes (recall@k on the
  promoted set). Surface `failed-query rate` and `retrieval-miss rate` as space-level metrics.
- Remediation hooks for retrieval-miss clusters: alias/synonym injection into the graph, re-chunk,
  rerank hard-negatives, threshold tuning — each validated against the golden set.
- Accept: a promoted golden question that previously failed now passes after the linked remediation;
  regressions are caught by the harness.

## Non-goals / deferred
- Fully automated remediation (Phase 5 provides the hooks + gating, not auto-tuning).
- Cross-space / global gap analytics.
- Real-time (hot-path) triage — intentionally async throughout.

## Risks & verification
- **No JS runtime here** — every slice is reasoned + unit-test-authored; run `pnpm check`. New table
  ⇒ schema.ts + hand-rendered migrations under the drift test.
- **Triage precision** is the make-or-break: an over-eager relevance gate floods annotation. Tune
  toward `uncertain`/`dismissed` on low confidence; measure annotation acceptance rate.
- **Summary-index cost**: the coarse summary embeddings are a new (small) projection; reuse the
  existing embedding provider + projection infra rather than a new store.
- **Coverage-gap ≠ golden question** must hold end-to-end, or the golden set rots.
