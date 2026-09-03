# Upgrade fast-uri for newly published security advisories

## What changed

- Raised the workspace `fast-uri` override from 3.1.5 to 3.1.6.
- Regenerated the pnpm lockfile so the MCP SDK's Ajv dependency resolves to the patched release.

## Why

GitHub published four high-severity `fast-uri` advisories affecting 3.1.5. Version 3.1.6 is the
first patched 3.x release, and the KnowledgeFS production-dependency audit blocks affected builds.

## Verification

- `pnpm security:dependencies`: passed.
- `pnpm ci:workflow:test`: passed.
- `pnpm --filter @knowledge/api typecheck`: passed.
- `git diff --check`: passed.

## Risks and follow-up

- This is a patch-level transitive dependency upgrade. No application behavior changes are expected.
