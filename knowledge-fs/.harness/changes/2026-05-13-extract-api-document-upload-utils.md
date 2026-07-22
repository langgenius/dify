# Extract API Document Upload Utilities

## Summary

- Extracted document upload parsing, bounded bulk upload parsing, SHA-256 hashing, and document status URL construction from `packages/api/src/index.ts`.
- Added `packages/api/src/document-upload-utils.ts` as the reusable upload boundary.
- Added focused unit tests and a code-health guardrail to prevent upload parsing and hashing from drifting back into the gateway file.

## Why

- This continues the R6 remediation for `docs/code-review-issues.md`: shrink the API gateway god file, keep validation and formatting helpers testable in small modules, and preserve bounded upload behavior.
- Upload parsing is performance-sensitive because it buffers file bodies; this boundary keeps per-file and aggregate byte limits visible and independently covered.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/document-upload-utils.test.ts src/code-health.test.ts` failed before `document-upload-utils.ts` existed.
- GREEN focused: `pnpm --filter @knowledge/api test -- src/document-upload-utils.test.ts src/code-health.test.ts src/gateway.test.ts`

## Notes

- The temporary progress documents were previously removed after iteration-plan completion; this permanent change summary records the slice per the current agent requirements.
- Review cadence restarted after checkpoint `f6ceb51`; this is implementation commit 1 after that checkpoint.
