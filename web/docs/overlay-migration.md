# Overlay Migration Guide

This document tracks the Dify-web migration away from legacy overlay APIs.

> **See also:** [`packages/dify-ui/README.md`] for the permanent overlay / portal / z-index contract of the replacement primitives. This document covers the one-off migration mechanics (deprecated import paths and coexistence z-index strategy) and is expected to shrink and eventually be removed once the legacy overlays are gone.

## Scope

- Deprecated imports:
  - `@/app/components/base/tooltip`
  - `@/app/components/base/modal`
  - `@/app/components/base/dialog`
  - `@/app/components/base/drawer`
  - `@/app/components/base/drawer-plus`
- Replacement primitives:
  - `@langgenius/dify-ui/tooltip`
  - `@langgenius/dify-ui/dropdown-menu`
  - `@langgenius/dify-ui/context-menu`
  - `@langgenius/dify-ui/popover`
  - `@langgenius/dify-ui/dialog`
  - `@langgenius/dify-ui/drawer`
  - `@langgenius/dify-ui/alert-dialog`
  - `@langgenius/dify-ui/autocomplete`
  - `@langgenius/dify-ui/combobox`
  - `@langgenius/dify-ui/select`
  - `@langgenius/dify-ui/toast`
- Tracking issue: <https://github.com/langgenius/dify/issues/32767>

## ESLint policy

- `no-restricted-imports` blocks all deprecated imports listed above.
- The rule is enabled for normal source files (`.ts` / `.tsx`) and test files are excluded.

## Migration phases

1. Business/UI features outside `app/components/base/**`
   - Migrate old calls to semantic primitives from `@langgenius/dify-ui/*`.
   - Keep deprecated imports out of newly touched files.
1. Legacy base components
   - Migrate legacy base callers gradually.
   - Keep deprecated imports out of newly touched files.
1. Cleanup
   - Remove legacy overlay implementations when import count reaches zero.

## z-index strategy

All new overlay primitives in `@langgenius/dify-ui/*` share a single z-index value:
**`z-1002`**, except Toast which stays one layer above at **`z-1003`**.

### Why z-[1002]?

During the migration period, legacy and new overlays coexist. Legacy overlays
portal to `document.body` with explicit z-index values:

| Layer                 | z-index      | Components                                                                               |
| --------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| Legacy Drawer         | `z-30`       | `base/drawer`, `base/drawer-plus`                                                        |
| Legacy Modal          | `z-60`       | `base/modal` (default)                                                                   |
| **New UI primitives** | **`z-1002`** | `@langgenius/dify-ui/*` (Drawer, Popover, Dialog, Autocomplete, Combobox, Tooltip, etc.) |
| Toast                 | `z-1003`     | `@langgenius/dify-ui/toast`                                                              |

`z-1002` sits above all common legacy overlays, so new primitives always
render on top without needing per-call-site z-index hacks. Among themselves,
new primitives share the same z-index and rely on **DOM order** for stacking
(later portal = on top).

Toast stays one layer above the overlay primitives so notifications remain
visible above dialogs, popovers, and other portalled surfaces without falling
back to `z-9999`.

### Rules

- **Do NOT add z-index overrides** (e.g. `className="z-1003"`) on new
  `@langgenius/dify-ui/*` components. If you find yourself needing one, the
  parent legacy overlay should be migrated instead.
- When migrating a legacy overlay that has a high z-index, remove the z-index
  entirely — the new primitive's default `z-1002` handles it.

### Post-migration cleanup

Once all legacy overlays are removed:

1. Reduce `z-1002` back to `z-50` across all `@langgenius/dify-ui/*` primitives.
1. Reduce Toast from `z-1003` to `z-51`.
1. Remove this section from the migration guide.

[`packages/dify-ui/README.md`]: ../../packages/dify-ui/README.md
