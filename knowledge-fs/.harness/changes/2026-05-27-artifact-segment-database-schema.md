# Artifact Segment Database Schema

Date: 2026-05-27

## Summary

Completed JH.2.4 by adding durable database schema and migration artifacts for
artifact segments.

## Changes

- Added `artifact_segments` to the database schema catalog.
- Added cascade foreign keys to KnowledgeSpace, DocumentAsset, and ParseArtifact.
- Added columns for segment index/type, artifact hash, segment checksum, optional
  object key, optional bounded inline text, content encoding, size, offsets,
  source location, metadata, and timestamps.
- Added indexes for:
  - unique `(parse_artifact_id, segment_index)`;
  - stable artifact segment pagination by `(knowledge_space_id, parse_artifact_id, segment_index, id)`;
  - checksum lookup by `(knowledge_space_id, checksum, id)`;
  - source document lookup by `(document_asset_id, start_offset, id)`.
- Regenerated PostgreSQL and TiDB initial schema migration artifacts.

## Verification

- `pnpm --filter @knowledge/database test -- src/schema.test.ts`
- `pnpm --filter @knowledge/database typecheck`
- `pnpm db:migrations:check`

## Known Follow-Ups

- SQL-backed artifact segment repository operations are not implemented yet.
- Parser output is not yet written into segment rows; that is planned in JH.2.5.
