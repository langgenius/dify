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
  - `@/app/components/base/toast` (including `context`)
- Replacement primitives:
  - `@/app/components/base/ui/tooltip`
  - `@/app/components/base/ui/dropdown-menu`
  - `@/app/components/base/ui/context-menu`
  - `@/app/components/base/ui/popover`
  - `@/app/components/base/ui/dialog`
  - `@/app/components/base/ui/alert-dialog`
  - `@/app/components/base/ui/select`
  - `@/app/components/base/ui/toast`
- Tracking issue: <https://github.com/langgenius/dify/issues/32767>

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

## Toast migration strategy

- During migration, `@/app/components/base/toast` and `@/app/components/base/ui/toast` may coexist.
- All new toast usage must go through `@/app/components/base/ui/toast`.
- When a file with legacy toast usage is touched, prefer migrating that call site in the same change; full-repo toast cleanup is not required in one PR.
- `@/app/components/base/ui/toast` is the design-system stack toast host. Legacy `ToastContext`, `ToastProvider`, anchored toast behavior, and ad-hoc mount patterns stay in `base/toast` until their call sites are migrated away.

## Allowlist maintenance

- After each migration batch, run:

```sh
pnpm -C web lint:fix --prune-suppressions <changed-files>
```

- If a migrated file was in the allowlist, remove it from `web/eslint.constants.mjs` in the same PR.
- Never increase allowlist scope to bypass new code.

## z-index strategy

All new overlay primitives in `base/ui/` share a single z-index value:
**`z-[1002]`**, except Toast which stays at **`z-[1101]`** during migration.

### Why z-[1002]?

During the migration period, legacy and new overlays coexist. Legacy overlays
portal to `document.body` with explicit z-index values:

| Layer                             | z-index          | Components                                   |
| --------------------------------- | ---------------- | -------------------------------------------- |
| Legacy Drawer                     | `z-[30]`         | `base/drawer`                                |
| Legacy Modal                      | `z-[60]`         | `base/modal` (default)                       |
| Legacy PortalToFollowElem callers | up to `z-[1001]` | various business components                  |
| **New UI primitives**             | **`z-[1002]`**   | `base/ui/*` (Popover, Dialog, Tooltip, etc.) |
| Legacy Modal (highPriority)       | `z-[1100]`       | `base/modal` (`highPriority={true}`)         |
| Toast (legacy + new)              | `z-[1101]`       | `base/toast`, `base/ui/toast`                |

`z-[1002]` sits above all common legacy overlays, so new primitives always
render on top without needing per-call-site z-index hacks. Among themselves,
new primitives share the same z-index and rely on **DOM order** for stacking
(later portal = on top).

Toast intentionally stays one layer above the remaining legacy `highPriority`
modal path (`z-[1100]`) so notifications keep their current visibility without
falling back to `z-[9999]`.

### Rules

- **Do NOT add z-index overrides** (e.g. `className="z-[1003]"`) on new
  `base/ui/*` components. If you find yourself needing one, the parent legacy
  overlay should be migrated instead.
- When migrating a legacy overlay that has a high z-index, remove the z-index
  entirely — the new primitive's default `z-[1002]` handles it.
- `portalToFollowElemContentClassName` with z-index values (e.g. `z-[1000]`)
  should be deleted when the surrounding legacy container is migrated.

### Post-migration cleanup

Once all legacy overlays are removed:

1. Reduce `z-[1002]` back to `z-50` across all `base/ui/` primitives.
1. Reduce Toast from `z-[1101]` to `z-[51]`.
1. Remove this section from the migration guide.

## React Refresh policy for base UI primitives

- We keep primitive aliases (for example `DropdownMenu = Menu.Root`) in the same module.
- For `app/components/base/ui/**/*.tsx`, `react-refresh/only-export-components` is currently set to `off` in ESLint to avoid false positives and IDE noise during migration.
- Do not use file-level `eslint-disable` comments for this policy; keep control in the scoped ESLint override.
