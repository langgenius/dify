# ADR 0003: Preserve portable provider references and historical emoji identifiers

Status: Accepted (existing behavior)
Date: 2026-11-23
Owners: `web/utils/provider-reference.ts`, `web/utils/emoji.ts`

## Context

Persisted UI/configuration identifiers outlive a workspace and the current emoji picker implementation. Database primary keys are not portable through DSL export/import.

## Decision

Persist an MCP provider's `server_identifier` when available. Match both historical primary-key references and portable server identifiers while old configurations exist. Resolve historical emoji-mart identifiers and aliases using the small legacy mapping rather than loading picker data.

## Consequences

Removing these compatibility paths requires a migration of persisted values and exported DSLs. Unknown emoji values pass through; an absent value uses the existing robot default. Provider IDs remain the fallback for other provider types.
