# Vinext, Dify API, and KnowledgeFS full-chain validation

## What changed

- Enabled the local KnowledgeFS direct-query stream for the Vinext origin and allowed the
  capability-bound `X-Trace-ID` header through CORS.
- Omitted a nullable query `sessionId` from the Dify-to-KnowledgeFS admission payload.
- Corrected Capability v2 query admission to compare the KnowledgeFS resource id, while preserving
  the separate Dify control-plane space id.
- Added explicit PostgreSQL casts for durable EvidenceBundle, AnswerTrace, and ResearchTask inserts.
- Made AnswerTrace evidence visibility resolve immutable node ids across publication generations,
  while retaining exact knowledge-space scoping.
- Added evidence text, citation document metadata, section title, score, and version to the
  authorized query evidence projection consumed by the Retrieval Test UI.

## Why

Real browser validation found failures that unit-only fixtures did not expose:

- direct stream requests were rejected by CORS/trace binding;
- nullable admission data violated the strict KnowledgeFS request schema;
- control-plane and resource ids were conflated during Capability v2 authorization;
- PostgreSQL could not infer UUID, timestamp, JSON, or varchar parameter types in several
  `INSERT ... SELECT` statements;
- published-generation evidence was incorrectly treated as missing;
- the evidence list lacked the chunk content needed by the UI.

## Verification

- Started Vinext on port 3000, the Dify Console API on port 5001, KnowledgeFS on port 8788,
  Dify workers, PostgreSQL, Redis, MinIO, Unstructured, the plugin daemon, and the local vector
  service.
- In the built-in browser, queried a ready KnowledgeFS space backed by the configured OpenRouter
  embedding and reasoning profiles.
- Fast and Deep both returned the ready document and displayed marker `OR-KFS-2026-07-28`.
- Research completed its Plan, Retrieve, Analyze, and Generate stages in four seconds and displayed
  the same persisted evidence.
- Confirmed the completed AnswerTrace/EvidenceBundle and ResearchTask records in PostgreSQL.
- Added regression coverage for CORS, Capability resource binding, durable PostgreSQL casts,
  published-generation evidence visibility, and evidence projection metadata.

## Notes

- The local environment does not have a separate reranker profile, so Deep resolved and completed
  as Deep with `rerankMs=0`; embedding, retrieval, LLM generation, durable trace persistence, and
  evidence readback were all exercised.
- `storage/` is pre-existing user-owned local data and was not modified.
