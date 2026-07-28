# Allow Capability-authorized integrated Space updates

Date: 2026-07-28

## What changed

- The knowledge-space update handler now recognizes an exact
  `knowledge_spaces.update` Capability v2 grant and does not fall back to the legacy local
  member/policy authorization aggregate.
- Database updates accept either the existing durable local permission snapshot fence or a
  Capability grant fence.
- Capability-backed updates revalidate the admitted grant, exact action/resource binding, and
  Space tombstone inside the same database transaction as the revision-CAS update.
- Revoked or fenced Capability grants return the same stable access-denied response as other
  knowledge-space authorization failures.
- Added handler and PostgreSQL/TiDB repository regressions for integrated Spaces with no local
  member or policy rows, plus revoked-grant denial.

## Why

Integrated provisioning deliberately leaves product authorization in Dify and does not create a
second KnowledgeFS member/policy aggregate. The generic update handler nevertheless attempted to
issue a local permission snapshot after the signed Dify Capability had already been verified and
admitted. As a result, valid description updates failed with 403 for every integrated Space.

## Verification

- Confirmed the regression tests failed before implementation with
  `KNOWLEDGE_SPACE_ACCESS_DENIED` and an invalid local permission snapshot.
- 60 focused API tests passed across integrated Capability handlers, knowledge-space repositories,
  update-handler coverage, standalone authorization, and Dify integration.
- `@knowledge/api` and `@knowledge/api-app` TypeScript checks passed.
- Focused Biome checks passed for all changed TypeScript files.
- Full `pnpm build` passed for all 12 KnowledgeFS workspace packages.
- Runtime verification through Dify succeeded: saving the description returned `Saved`, cleared the
  dirty state, and persisted the requested `.111` suffix without an unavailable error.
- Full `pnpm lint` was run but remains red on nine unrelated pre-existing formatting/lint findings
  in admin, test, and generated contract files; none are in this change.
- Full `pnpm check` was not run because it includes the already-failing full lint state plus
  coverage, Docker, compose, and local-stack smoke gates outside this focused authorization fix.

## Risks and follow-up

- The Dify console API currently collapses all KnowledgeFS 4xx/5xx upstream responses into a 502
  unavailable error, so future validation or authorization failures may still be mislabeled in the
  UI. This change fixes the update authorization path but does not change that broader error
  translation contract.
