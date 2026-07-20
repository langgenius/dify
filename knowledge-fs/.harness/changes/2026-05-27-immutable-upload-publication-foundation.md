# Immutable Upload Publication Foundation

Date: 2026-05-27

## Summary

Completed the first JH.2.1 slice by making the synchronous single-document upload path
record staged commit state and verify the uploaded object before publishing document
metadata.

## Changes

- Single-document uploads now create a `document-upload` staged commit before object
  storage writes.
- Uploaded objects are verified with `headObject` for existence, size, and checksum
  metadata before `DocumentAsset` creation.
- Unverified staged objects are cleaned up and the commit is marked
  `failed-retryable` with `object_verification_failed`.
- Successful synchronous uploads transition the staged commit through object,
  metadata, artifact, and published states.
- Synchronous parser failures keep the raw object and visible failed asset while
  marking the staged commit `failed-terminal` with `parser_failed`.
- The gateway now passes the staged commit repository and clock into document write
  handlers.

## Verification

- `pnpm --filter @knowledge/api test -- src/gateway-document-write.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`

The targeted test command ran the package test suite and passed.

## Known Follow-Ups

- Bulk uploads and durable compilation workers still need staged commit lifecycle
  integration.
- The staged commit repository is still in-memory by default until durable
  repository implementations are added.
- Object verification currently relies on stored metadata and size. Content digest
  re-read verification can be added behind an explicit cost/latency policy.
