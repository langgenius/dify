# Detailed retrieval tracing (staged steps + graph timing + OTLP export)

Date: 2026-07-09

Closes the three tracing gaps identified in the retrieval-observability review, in order.

## 1. Per-stage answer-trace steps (was: one flat "query.generate")
- New `trace-step` variant on `QueryGenerationEvent` + `traceStepEvent()` helper
  (gateway-sse-responses). Generators yield real, timestamped stage steps; the SSE writer
  NEVER streams them to clients; `recordAnswerTrace` lifts them into the persisted trace ahead
  of the unchanged `query.generate` summary step (downstream consumers keep working).
- `AnswerTraceRecorder` now honors caller-provided `startedAt`/`endedAt` per step (previously it
  flattened every step to the trace timestamp).
- Instrumented stages:
  - hybrid generator: `query.embed` (when an embedding provider is wired, with model),
    `query.retrieve` (itemCount + plan + full retrieval metrics incl. dense/fts/fusion/rerank ms),
    `query.answer` (extractive vs multimodal-provider synthesis, answerChars).
  - llm-answer generator: same `query.embed`/`query.retrieve`, plus `query.answer` for the
    multimodal-provider path (a failed VLM attempt records a **status: error** step before the
    text-LLM fallback) and the LLM streaming path (durationMs, model, provider,
    providerFinishReason, answerChars) — the LLM generation phase finally has its own timing.
- `GET /queries/{traceId}` now returns a real per-stage waterfall.

## 2. Graph-expansion timing
- `HybridRetrievalMetrics` gains `graphExpansionMs` (wall-clock across traversals + boosted
  re-retrieval + merge) and `graphExpansionTimedOut` (any traversal hit its budget). Deep-mode
  slowness is now attributable to the graph stage.

## 3. Span export (TraceRecorder was noop in production)
- `tracing-exporters.ts`: `createConsoleTraceRecorder` (one JSON line per span) and
  `createOtlpTraceRecorder` — a dependency-free OTLP/HTTP JSON exporter (fetch-based, batched,
  unref'd flush timer, buffer cap with drop counting, best-effort export via `onExportError`;
  BigInt-exact unix-nano timestamps; spans are root spans since the seam has no context
  propagation).
- apps wiring: `KNOWLEDGE_TRACING=off|console|otlp` (off default) + `_OTLP_ENDPOINT`,
  `_OTLP_HEADERS` (JSON), `_SERVICE_NAME`, `_FLUSH_MS`; documented in .env.example. Existing
  spans (`retrieval.plan`, ingestion traceAsync) start flowing without further changes.

## Tests
- generator tests: collectors filter trace-steps (positional assertions preserved) + new focused
  step-sequence tests per generator; SSE test proves steps are lifted into the trace and absent
  from the wire; recorder timestamp-honoring covered via the SSE test's explicit boundaries.
- apps retriever test asserts graphExpansionMs/TimedOut in deep-mode metrics.
- exporter tests: console line shape; OTLP batch shape (resource/scope/span, attr typing,
  nano timestamps, id formats), error status mapping, buffer-cap drop, failed-POST reporting,
  config validation; apps env-factory tests (off default, modes, fail-fast errors).

## Notes
- Trace metrics appear both in the `query.retrieve` step and (as before) folded into the
  `query.generate` summary metadata — intentional back-compat duplication.
- Follow-up candidates: span-per-stage mirroring into the TraceRecorder from generators; trace
  context propagation (parent spans) if the OTLP path proves useful.
