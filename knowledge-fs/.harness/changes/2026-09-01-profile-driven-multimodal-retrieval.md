# Profile-driven multimodal ingestion, retrieval, and answers

## Why

KnowledgeFS could already materialize images from documents, but visual indexing, query-image
retrieval, document image understanding, and image-aware answers were selected by six independent
deployment variables. That allowed a deployment-selected model to diverge from the immutable
embedding/reasoning profiles of a knowledge space and left the retrieval UI without an image input.

## What changed

- Model capability snapshots now freeze normalized text/image input modalities. Vision embedding
  activation performs one text probe plus real 1x1 PNG document-input and query-input probes, and
  requires one model identity and vector dimension across all three paths.
- New snapshots use their immutable capability declaration. Legacy snapshots use a bounded catalog
  lookup only when the installed plugin identity, schema fingerprint, and full frozen capability
  digest still match; malformed legacy snapshots, drift, cancellation-safe catalog failure, and
  stale negative-cache entries all fail closed to text-only without making the request fail.
- Document parsing extracts images when either the frozen embedding or reasoning profile accepts
  image input. Visual projections use the frozen embedding profile model; text-only profile
  migrations remove stale visual projections, while vision migrations rebuild them.
- Text-to-image retrieval reuses the already computed profile query vector, so enabling visual
  search does not duplicate the normal text embedding call. Query images use the same profile's
  image embedding route and the matching published visual vector space.
- Fast, Deep, and durable Research accept up to four authenticated query-image uploads. A
  vision-capable reasoning profile may perform one bounded image-to-text expansion; pure-image
  requests fail explicitly when neither selected profile accepts images.
- The active reasoning profile controls lazy document image enrichment and final multimodal answer
  generation. Text-only reasoning models receive OCR/caption/text evidence only. VLM object reads
  are streamed with per-image and aggregate byte ceilings, cancellation, and process-wide
  enrichment/answer lifecycle admission. Query expansion, enrichment, and answer model calls also
  share the global model-request gate so separate multimodal routes cannot multiply provider load.
- The retrieval UI now uploads, previews, removes, and submits query images, including image-only
  requests. Object URLs are revoked on removal, scope changes, and unmount. A space whose frozen
  embedding and reasoning profiles are both text-only records an explicit degradation without
  loading the image bodies; an image-only request still fails closed instead of becoming an empty
  text query.
- The Workflow/Chatflow KnowledgeFS v2 node now accepts an optional image or image-array selector
  and forwards the same bounded image references to every selected space. Each space resolves its
  own frozen embedding/reasoning capabilities: vision embeddings run a direct visual leg,
  text-only embeddings may use that space's vision reasoning model for bounded image-to-text
  expansion, and spaces with neither capability keep text retrieval active with an explicit
  per-space degradation flag. One text-only space therefore cannot disable visual retrieval in
  another space, and it does not fetch image bytes that it cannot use. The existing balanced
  cross-space reranker still merges all per-space candidates.
- Workflow graph files are authorized before the KFS call and represented by a short-lived,
  app/tenant/file-scoped HMAC grant. The public retrieval JSON body remains a clean list of file
  ids; the grant travels only through operation-scoped internal headers and transient resolver
  input. Storage keys, raw image bytes, and the grant itself are excluded from Workflow node
  inputs, traces, checkpoints, and evidence metadata. Direct console retrieval keeps its existing
  account-owned UploadFile authorization path.

## Compatibility and operations

Production assembly no longer reads `KNOWLEDGE_VISUAL_EMBEDDING_PROVIDER`,
`KNOWLEDGE_VISUAL_EMBEDDING_MODEL`, `KNOWLEDGE_VISUAL_EMBEDDING_QUERY_MODE`,
`KNOWLEDGE_QUERY_IMAGE_RETRIEVAL_ENABLED`, `KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER`, or
`KNOWLEDGE_MULTIMODAL_ANSWER_PROVIDER`. Deprecated source-compatible option constructors remain for
out-of-tree callers, but cannot affect the production service.

Operators retain only resource ceilings for image count, bytes, concurrency, timeout, output
tokens, and detail. Existing active vision profiles require one ordinary profile reindex/migration
or document recompilation to backfill visual projections. No database migration is required.
