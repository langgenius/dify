# ADR 0005: Preserve browser interaction and runtime fallback boundaries

Status: Accepted (existing behavior)
Date: 2026-11-23

## Context and decisions

- `web/utils/page-leave-guard.ts`: confirmation guards are separate from `beforeunload` listeners that save drafts or release locks. Do not probe guards by dispatching `beforeunload`, because that triggers those side effects. Confirm before logout sends its server request. Retain the machine-consumed alert suppression.
- `web/utils/clipboard.ts`: Clipboard API access can fail even in a secure context. Continue to the legacy copy path after rejection. Keep the temporary textarea fixed so focusing it does not scroll the page to the bottom.
- `web/utils/get-adjacent-focus-targets.ts`: capture focus candidates before the source item unmounts. Prefer following siblings, then preceding siblings in reverse order, so deleting an item has deterministic neighboring targets.
- `web/utils/timezone.ts`: resolve the offset for the supplied instant with `Intl`, including DST; return undefined if unsupported. Fall back to the static name's standard offset when the runtime lacks the timezone. The fallback is not a DST-aware substitute. Retain the coverage directive for malformed normalized data.
- `web/utils/urlValidation.ts:validateRedirectUrl`: allow only HTTP and HTTPS navigation targets to avoid executing script URLs. Private-address detection is a separate hostname helper and does not claim comprehensive SSRF protection.

## Consequences

Changes to these helpers must preserve visible focus, scroll position, confirmation ordering, and explicit fallback semantics. Existing source directives remain part of tool behavior, while rationale lives here.
