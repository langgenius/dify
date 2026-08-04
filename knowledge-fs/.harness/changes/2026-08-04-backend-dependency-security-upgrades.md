# Backend dependency security upgrades

## What changed

- Raised the workspace override for `fast-uri` from `3.1.4` to `3.1.5`.
- Added a workspace override for `ip-address` at `10.3.1`.
- Regenerated `pnpm-lock.yaml` so the `@modelcontextprotocol/sdk` dependency paths resolve the patched releases.
- Extended the CI workflow regression test to keep both security overrides and lockfile resolutions pinned.

## Why

The production dependency audit began blocking on two high-severity advisories published against the previously locked transitive versions:

- `GHSA-7p8r-x3mc-p8w7` affected `fast-uri` versions before `3.1.5` in the selected major line.
- `GHSA-mwp4-54f8-5fhr` affected `ip-address` versions through `10.3.0`.

Both patched versions remain within the dependency ranges declared by `ajv` and `express-rate-limit`, so the remediation does not require an MCP SDK or dependency-major upgrade.

## Verification

- Reproduced the failure with `pnpm security:dependencies`; both advisories were reported before the lock update.
- `pnpm install --frozen-lockfile`: passed.
- `pnpm security:dependencies`: passed with no high or critical backend production vulnerabilities.
- `node --test scripts/github-actions-workflow.test.mjs`: passed, 16 tests.
- `CI=1 pnpm check`: passed.
- `CI=1 pnpm build`: passed.
- `CI=1 pnpm lint:backend`: passed.
- `pnpm exec biome check package.json scripts/github-actions-workflow.test.mjs`: passed.
- `CI=1 pnpm lint`: remains blocked by 10 pre-existing repository-wide Admin formatting and oversized generated OpenAPI findings outside this dependency-only change.

## Risks and follow-up

- The overrides intentionally pin transitive dependencies until their direct parents advance their minimum versions. Dependabot and the security audit should continue to monitor them.
- No application behavior or API contract changed.
