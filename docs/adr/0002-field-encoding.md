# ADR 0002: Preserve the authentication field encoding contract

Status: Accepted (existing behavior)
Date: 2026-11-23
Owner: `web/utils/encryption.ts`

## Context

The historical `encrypt*` names can suggest cryptographic protection, but the implementation performs Base64 encoding of login passwords and verification codes.

## Decision

Treat this as an encoding contract, not encryption. HTTPS provides transport confidentiality. Encode UTF-8 bytes before calling the ASCII-only `btoa` so non-ASCII inputs survive transmission. If encoding fails, throw rather than sending plaintext. There is no flag that returns the original input when encoding is disabled; the removed return-value documentation was stale.

## Consequences

Keep this behavior compatible with the receiving authentication API. Renaming or changing the wire representation requires a coordinated API migration. Base64 does not add cryptographic security.
