# KnowledgeFS unified error handling

## Goal

Replace the current mix of raw exceptions, generic strings, status-only proxy errors, and UI pass-through messages with one safe and actionable public error contract across KnowledgeFS, the Dify API BFF, background tasks, polling/SSE, and the New RAG UI.

The implementation must preserve internal diagnostic detail without exposing provider payloads, credentials, request headers, signed URLs, stack traces, or other unsafe values to product clients.

## Compatibility strategy

- Keep existing `code`/`error` HTTP fields and `errorCode`/`errorMessage` task fields during the transition.
- Add structured failure metadata rather than replacing existing fields in one breaking change.
- Persist stable error codes and safe fallback messages; localize at the Dify Web boundary.
- Derive retry policy and recommended actions from the central error catalog wherever possible, avoiding an initial database migration.
- Unknown exceptions always become a generic internal failure with a trace/support identifier; their original cause remains log-only.

## Iteration plan

### P0 — Inventory and contract design

- [x] Inventory existing public error schemas, task failure fields, retry behavior, BFF mappings, and UI consumers.
- [x] Define categories, retry policies, recommended actions, safe parameters, and transport naming.
- [x] Define backward-compatible HTTP and background-task failure schemas.
- [x] Document security rules for public versus internal diagnostic messages.

### P1 — KnowledgeFS error foundation

- [x] Add a central error catalog containing stable codes and public metadata.
- [x] Add a typed `KnowledgeFsError` and a boundary normalizer for typed domain errors, provider errors, aborts/timeouts, validation failures, and unknown exceptions.
- [x] Add helpers that serialize only allowlisted public metadata.
- [x] Retain existing validation/not-found classes as compatible typed specializations.
- [x] Add unit tests for catalog completeness, sanitization, retry policies, safe parameter filtering, and unknown errors.

### P2 — Document compilation and model preflight

- [x] Replace the generic “selected model could not be validated” collapse with stable actionable model errors.
- [x] Split model-not-found, credentials-invalid, validation-unavailable/timeout, capability mismatch, identity mismatch, and embedding-dimension failures.
- [x] Keep automatic retry behavior for transient failures and mark configuration failures as `after_configuration` or `never`.
- [x] Ensure persisted task messages are safe public fallbacks, not raw provider exceptions.
- [x] Add regression tests for each model/preflight outcome.

### P3 — Background tasks and streams

- [x] Add a structured `failure` object to document, source, and bulk task responses.
- [x] Derive `canRetry` from failure retry policy instead of terminal state alone.
- [x] Return the same failure object through list/polling and terminal SSE events.
- [x] Preserve legacy task fields for existing clients.
- [x] Add task mapping, retry-control, list response, and SSE parity tests.

### P4 — HTTP gateway

- [x] Expand the shared KnowledgeFS error response schema with safe message, retry policy, action, parameters, and trace ID.
- [x] Normalize typed errors in the global gateway handler.
- [x] Keep route-specific compatibility fields while removing raw exception exposure.
- [x] Add OpenAPI and handler tests for known, validation, not-found, timeout, and unknown errors.

### P5 — Dify API BFF

- [x] Parse and validate allowlisted KnowledgeFS public error payloads.
- [x] Preserve safe upstream code and metadata in `KnowledgeFSProductRequestRejectedError` instead of retaining only HTTP status.
- [x] Map the structured error into the Console API response while retaining existing generic fallbacks.
- [x] Keep malformed or unrecognized upstream payloads masked.
- [x] Add remote-client, service, controller, and DTO tests.

### P6 — Web product experience

- [x] Add a feature-owned error resolver using generated contract types.
- [x] Add localized messages for every public error code in all supported locales.
- [x] Render safe localized messages instead of raw backend strings.
- [x] Select Retry, Configure model, Configure parser, Re-upload, or Contact administrator actions from the failure contract.
- [x] Preserve accessible button names and existing task interaction behavior.
- [x] Add focused unit/component tests for permanent, configuration-dependent, transient, and unknown failures.

### P7 — Remaining major boundaries

- [x] Route upload, parser, storage, source, research, query, metadata, and authorization boundary failures through the common normalizer.
- [x] Reuse the existing safe source-operation allowlist through the common catalog.
- [x] Remove direct public use of provider/runtime error messages at migrated boundaries.
- [x] Add code-health coverage preventing new unregistered public task error codes and unsafe raw-message pass-through.

### P8 — Contracts, documentation, and verification

- [x] Regenerate KnowledgeFS OpenAPI/capability artifacts and Dify generated contracts.
- [x] Update the KnowledgeFS contract lock intentionally after reviewing subtree changes.
- [x] Document public error codes, retry semantics, and client behavior.
- [x] Run targeted KnowledgeFS, API, and Web tests plus type/lint/contract gates.
- [x] Review the final diff without staging or overwriting unrelated workspace changes.

## Acceptance criteria

- Every migrated public failure has a stable registered code, safe fallback message, category, retry policy, and recommended action.
- Model configuration failures no longer display the same generic English sentence.
- A permanent or configuration-dependent failure never presents a misleading immediate Retry action.
- Polling and SSE expose equivalent failure metadata.
- Dify API preserves valid safe KnowledgeFS error codes instead of reducing all 4xx responses to HTTP status alone.
- Web displays localized actionable copy and never renders a raw provider exception.
- Unknown errors display a generic message plus a trace/support identifier while full diagnostics remain server-side.
- Existing clients using legacy `error`, `errorCode`, and `errorMessage` fields continue to function during migration.
- Automated tests cover security masking, contract compatibility, retry semantics, and user-visible behavior.
