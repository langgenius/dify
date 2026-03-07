# Overlay Migration Guide

This document tracks the migration away from legacy overlay APIs.

## Scope

- Deprecated imports:
  - `@/app/components/base/portal-to-follow-elem`
  - `@/app/components/base/tooltip`
  - `@/app/components/base/modal`
  - `@/app/components/base/confirm`
  - `@/app/components/base/select` (including `custom` / `pure`)
  - `@/app/components/base/popover`
  - `@/app/components/base/dropdown`
  - `@/app/components/base/dialog`
- Replacement primitives:
  - `@/app/components/base/ui/tooltip`
  - `@/app/components/base/ui/dropdown-menu`
  - `@/app/components/base/ui/popover`
  - `@/app/components/base/ui/dialog`
  - `@/app/components/base/ui/alert-dialog`
  - `@/app/components/base/ui/select`
- Tracking issue: https://github.com/langgenius/dify/issues/32767

## ESLint policy

- `no-restricted-imports` blocks all deprecated imports listed above.
- The rule is enabled for normal source files (`.ts` / `.tsx`) and test files are excluded.
- Legacy `app/components/base/*` callers are temporarily allowlisted in `OVERLAY_MIGRATION_LEGACY_BASE_FILES` (`web/eslint.constants.mjs`).
- New files must not be added to the allowlist without migration owner approval.

## Migration phases

1. Business/UI features outside `app/components/base/**`
   - Migrate old calls to semantic primitives from `@/app/components/base/ui/**`.
   - Keep deprecated imports out of newly touched files.
1. Legacy base components in allowlist
   - Migrate allowlisted base callers gradually.
   - Remove migrated files from `OVERLAY_MIGRATION_LEGACY_BASE_FILES` immediately.
1. Cleanup
   - Remove remaining allowlist entries.
   - Remove legacy overlay implementations when import count reaches zero.

## Allowlist maintenance

- After each migration batch, run:

```sh
pnpm -C web lint:fix --prune-suppressions <changed-files>
```

- If a migrated file was in the allowlist, remove it from `web/eslint.constants.mjs` in the same PR.
- Never increase allowlist scope to bypass new code.

## React Refresh policy for base UI primitives

- We keep primitive aliases (for example `DropdownMenu = Menu.Root`) in the same module.
- For `app/components/base/ui/**/*.tsx`, `react-refresh/only-export-components` is currently set to `off` in ESLint to avoid false positives and IDE noise during migration.
- Do not use file-level `eslint-disable` comments for this policy; keep control in the scoped ESLint override.
