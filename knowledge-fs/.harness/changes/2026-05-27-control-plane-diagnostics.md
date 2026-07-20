# Control Plane Diagnostics

Date: 2026-05-27

## Summary

Completed JH.1.8 from the JuiceFS-inspired hardening plan by exposing read-only
KnowledgeSpace control-plane diagnostics through the API.

## Changes

- Added `GET /knowledge-spaces/{id}/manifest` for tenant-scoped manifest inspection.
- Added `GET /knowledge-spaces/{id}/staged-commits` for bounded, tenant-scoped
  staged commit diagnostics with optional status filtering.
- Wired the gateway to use a default in-memory staged commit repository when no
  durable implementation is injected.
- Added OpenAPI response schemas for manifests and staged commits.
- Added gateway tests proving:
  - legacy spaces lazily expose a default manifest through the read-only route;
  - the manifest endpoint is not writable by accidental `PATCH`;
  - staged commit diagnostics are filtered and paginated through repository bounds;
  - over-limit diagnostic reads return `400`.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-space-control-plane-diagnostics.test.ts`

The targeted command ran the package test suite and passed.

## Known Follow-Ups

- The diagnostics currently use repository interfaces and in-memory defaults. A
  database-backed manifest and staged commit repository is still needed before
  durable deployments can retain this state across process restarts.
- These routes are API-level diagnostics only. Admin/MCP operator surfaces are
  still planned in JH.7.
