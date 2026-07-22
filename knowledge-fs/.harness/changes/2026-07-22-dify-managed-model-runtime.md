# Route all KnowledgeFS model calls through Dify model management

Date: 2026-07-22

## Why

KnowledgeFS previously constructed plugin-daemon model dispatch payloads itself, including a
model-credential field. That bypassed Dify's tenant-scoped model configuration and duplicated a
responsibility already owned by `ModelManager` and `ModelInstance`. It also made embedding,
reranking, LLM, and multimodal paths behave differently from native Dify model calls.

## Runtime changes

- Added bounded Dify inner endpoints for multimodal embedding and the tenant-active model catalog;
  text embedding, rerank, and LLM continue through their existing inner endpoints.
- Bound every invocation inside Dify with
  `ModelManager.for_tenant(...).get_model_instance(...)`, then called the corresponding
  `ModelInstance` method. Dify resolves the workspace provider configuration and model credentials.
- Added `@knowledge/dify-model-runtime-client` for authenticated, size-limited and deadline-bound
  inner-API calls, including Dify's length-prefixed LLM stream protocol.
- Rewired text embedding, visual/multimodal embedding, rerank, answer generation, semantic
  extraction, multimodal understanding, and Auto routing to that client.
- Replaced the plugin-daemon model catalog with a Dify tenant-active catalog. KnowledgeFS persists
  routing identity and capability fingerprints, but does not accept, store, copy, or forward model
  credentials.
- Removed direct model dispatch, model catalog, and model credential-management methods from the
  KnowledgeFS plugin-daemon client; it is now datasource-only. Website crawl, online-document,
  online-drive, and datasource credential validation remain direct plugin-daemon responsibilities
  and are intentionally unchanged.
- Added deployment/readiness settings for `DIFY_INNER_API_URL` and `DIFY_INNER_API_KEY`; the key
  matches Dify's `INNER_API_KEY_FOR_PLUGIN`. Legacy `plugin-daemon` provider selector values remain
  accepted only as configuration aliases and resolve to the Dify model runtime.
- Added architecture regression tests that reject plugin-daemon imports, direct model dispatch, or
  model credential fields in KnowledgeFS model paths.

## Scope

This is a backend-only change. It does not modify the Dify web application or KnowledgeFS Admin UI,
and it does not perform production credential rotation, workspace cutover, or legacy knowledge-base
migration.

## Verification

- Dify focused Pytest suite: 29 passed.
- KnowledgeFS API app: typecheck passed; 199 tests passed.
- Dify runtime client, plugin-daemon datasource client, embeddings, and generation packages:
  typecheck passed; 118 tests passed. The Dify runtime client has 100% statement, branch,
  function, and line coverage.
- Final workspace, formatting, Compose, and frozen-lockfile checks are recorded in the task handoff.
