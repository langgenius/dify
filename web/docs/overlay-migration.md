# Overlay Migration Guide

This document tracks the migration away from legacy `portal-to-follow-elem` APIs.

## Scope

- Deprecated API: `@/app/components/base/portal-to-follow-elem`
- Replacement primitives:
  - `@/app/components/base/ui/tooltip`
  - `@/app/components/base/ui/dropdown-menu`
  - `@/app/components/base/ui/popover`
  - `@/app/components/base/ui/dialog`
  - `@/app/components/base/ui/select`
- Tracking issue: https://github.com/langgenius/dify/issues/32767

## ESLint policy

- `no-restricted-imports` blocks new usage of `portal-to-follow-elem`.
- The rule is enabled for normal source files and test files are excluded.
- Legacy `app/components/base/*` callers are temporarily allowlisted in ESLint config.
- New files must not be added to the allowlist without migration owner approval.

## Migration phases

1. Business/UI features outside `app/components/base/**`
   - Migrate old calls to semantic primitives.
   - Keep `eslint-suppressions.json` stable or shrinking.
2. Legacy base components in allowlist
   - Migrate allowlisted base callers gradually.
   - Remove migrated files from allowlist immediately.
3. Cleanup
   - Remove remaining suppressions for `no-restricted-imports`.
   - Remove legacy `portal-to-follow-elem` implementation.

## Suppression maintenance

- After each migration batch, run:

```sh
pnpm eslint --prune-suppressions --pass-on-unpruned-suppressions <changed-files>
```

- Never increase suppressions to bypass new code.
- Prefer direct migration over adding suppression entries.

## React Refresh policy for base UI primitives

- We keep primitive aliases (for example `DropdownMenu = Menu.Root`) in the same module.
- To avoid IDE noise, `react-refresh/only-export-components` is configured with explicit `allowExportNames` for the base UI primitive surface.
- Do not use file-level `eslint-disable` comments for this policy.
