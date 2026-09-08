# Model-aware semantic budgeting and bounded recovery

The v6 document compiler still requests boundaries, section attribution, summaries, and enabled
entity/relation extraction together. Normal processing does not introduce a second extraction call
per window. This policy applies after parsing to every supported document format, not just PDFs.

## Capacity source

Dify resolves the selected knowledge-space reasoning model using its tenant-bound runtime schema.
`model_properties.context_size` supplies context capacity. The output parameter rule's `max`
supplies maximum output tokens; its `default` is **not** a maximum. Supported rule names include
`max_tokens`, `max_completion_tokens`, `max_output_tokens`, and `maxtoken`, as well as custom names
using the `max_tokens` template. The actual parameter name is forwarded to the provider. When more
than one bounded alias is declared, the tighter limit wins.

The exact selected-model catalog response adds optional `token_limits` independently of the
capability fingerprint. Existing model-profile approvals remain valid, and listing all models does
not perform a schema lookup per item. Missing values use explicit compatibility fallbacks of 16,384
context tokens and 6,000 output tokens; these are not inferred model capacities. Invalid metadata
does not grant an unlimited budget. Metrics identify `model`, `partial-model`, or `fallback` sources.

## Window admission

Each generation freezes its policy in the existing semantic-window checkpoint store before model
work. The policy also travels in the completed generation receipt. Worker redelivery, retries, and
receipt replay use that same policy rather than re-reading changing model metadata.

Window planning estimates the **complete** prompt, including system instructions, unit metadata,
section paths and look-ahead. It reserves output for the joint JSON and leaves context headroom.
Both input and predicted output influence window size. Graph/PageIndex flags influence predicted
output; disabled extraction does not reserve its normal per-unit cost. Estimates use UTF-8 bytes
and structural cost and are not claimed as exact tokenizer counts or actual provider usage.

Operational guards remain separate from model capability: at most 256 core units, 200,000 core
characters, a 32,768-token target input budget, and 65,536 requested output tokens per call. They
bound memory, latency, and worker fairness even for models with million-token contexts. Actual
requests must also fit the model's output limit and remaining context, including retry feedback.
Atomic-unit and final chunk-size constraints remain unchanged.

The old `KNOWLEDGE_SEMANTIC_CHUNKING_MAX_WINDOW_CHARS` setting remains the legacy-layout fallback.
New model-aware generations do not inherit its old 4,800-character default. An explicit per-task
`maxWindowChars` still bounds the planner. A generation with successful pre-upgrade window
checkpoints retains its exact old layout so those completions can be reused; failed windows can
still receive larger output budgets or be subdivided.

## Recovery limits

1. Recognize provider termination reasons such as `length` and `max_tokens`. If termination metadata
   is absent, infer truncation only when JSON is unusable **and** reported output usage reaches the
   requested limit. Valid JSON is not rejected just because its usage equals that limit.
2. Increase output allowance geometrically within model/context/operational bounds. Never repeat
   an already saturated allowance. The last increase uses the remaining safe capacity, allowing
   reasoning overhead even for a small JSON estimate. Schema/grounding failures retain their existing validation
   retries, sharing the per-window retry allowance with output increases (at most three retries).
3. If necessary, bisect only the failed fixed-core window at canonical atomic-unit boundaries.
   There are at most three split levels and sixteen provider calls across one root window's entire
   recovery tree per execution attempt, additionally charged to the document-wide request/token
   budget. A precise model
   timeout can also trigger subdivision for model-aware windows, without raising operator timeouts.
   Cancellation, authentication errors, rate limiting, and arbitrary transport failures do not.
4. Persist the split decision and each validated child. Redelivery resumes unfinished children,
   not the known-failing parent or successful siblings. Successful child results are revalidated
   together and stored under the parent's canonical checkpoint/receipt identity.

Full coverage, ordering, grounded facts, table/image isolation, and immutable publication fences
remain mandatory. Partial JSON is never accepted or patched into a successful document. Recovery
exhaustion reports `MODEL_RUNTIME_OUTPUT_LIMIT`; an unfit context reports
`MODEL_RUNTIME_CONTEXT_LIMIT`. Persistent timeouts keep their timeout classification. Malformed
non-truncated output keeps `MODEL_RUNTIME_RESPONSE_INVALID`.

## Verification and rollout

Unit coverage exercises large/small model limits, parameter aliases, absent metadata, legacy and
new receipt replay, checkpoint isolation, output growth, child resumption, persistent truncation,
timeouts, and cancellation. Local tests use deterministic provider fixtures; they do not establish
real-model throughput or guarantee every document will succeed.

Deploy Dify API and KnowledgeFS together, then restart the existing document-worker processes and
retry the failed task. No new database migration or worker replica is required. Observe requested
output tokens, actual token usage, finish reason, recovery window IDs, and cache hits in
`knowledge_fs.ingestion_model_call.metric`; no document text or model credentials are logged.
Model output/context exhaustion now has separate localized task messages.

Do not roll an in-flight model-aware generation back to code that cannot read its frozen policy.
Keep checkpoints for forward retry and perform rollback only after handling those generations.
