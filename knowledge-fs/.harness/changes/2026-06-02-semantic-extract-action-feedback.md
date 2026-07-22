# Semantic extract action feedback

## Summary

- Changed the Admin `Extract entities` action to run community materialization
  immediately after entity extraction succeeds.
- Returned a client-visible `400` error when semantic entity extraction is
  requested without an LLM provider, instead of falling through to the generic
  gateway `500` handler.
- Updated the Admin API client to read bounded `{ "error": "..." }` response
  bodies from failed API calls and surface the real message in Admin notices.
- Added semantic LLM environment placeholders to `.env.example` and passed them
  through to the Docker API service in `compose.yaml`.

## Why

Clicking `Extract entities` could appear to do nothing when the API was missing
LLM configuration or when users expected communities to refresh as part of the
same semantic graph rebuild. The UI now gives a clear configuration error, and a
successful extraction also refreshes `/knowledge/by-community`.

## Verification

- `pnpm --filter @knowledge/admin test -- app/admin-action-routes.test.ts lib/api-client.test.ts`
- `pnpm --filter @knowledge/api test -- src/gateway-document-write.test.ts src/semantic-operator-actions.test.ts`
- `pnpm --filter @knowledge/api-app test -- src/llm-options.test.ts`
- `pnpm --filter @knowledge/admin typecheck`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api-app typecheck`
- `docker-compose --env-file .env.example -f compose.yaml config`
- `git diff --check`

## Risks and follow-up

- If neither `OPENAI_API_KEY` nor `ANTHROPIC_API_KEY` is configured for the API
  process, semantic extraction still cannot generate entities. This is now
  reported explicitly as an operator configuration error.
