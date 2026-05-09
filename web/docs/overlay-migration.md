# Overlay Migration Guide

This document tracks the Dify-web migration away from legacy overlay APIs.

> **See also:** [`packages/dify-ui/README.md`] for the permanent overlay / portal / z-index contract of the replacement primitives. This document covers the one-off migration mechanics (deprecated import paths and coexistence z-index strategy) and is expected to shrink and eventually be removed once the legacy overlays are gone.

## Scope

- Deprecated imports:
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
  - `@langgenius/dify-ui/preview-card`
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
   - Use `@langgenius/dify-ui/tooltip` only for short, non-interactive labels where the trigger already has its own accessible name.
   - Use `@langgenius/dify-ui/popover` or the web `Infotip` wrapper for explanatory, long-form, structured, or interactive content.
1. Legacy base components
   - Migrate legacy base callers gradually.
   - Keep deprecated imports out of newly touched files.
1. Cleanup
   - Remove legacy overlay implementations when import count reaches zero.

## z-index strategy

All new body-portalled overlay primitives in `@langgenius/dify-ui/*` share a single z-index value:
**`z-1002`**, except Toast which stays one layer above at **`z-1003`**.

This section compares only overlay surfaces that portal to `document.body`.
Regular React-tree layers such as sticky headers, canvas chrome, editor helper
panels, and other in-tree `z-*` values are outside this overlay stacking
contract.

### Why z-[1002]?

As of 2026-05-09, the repo is **not ready** to reduce the shared overlay layer
to `z-50`. New primitives can drop to `z-50` only after the remaining
body-portalled legacy drawers are gone.

During the migration period, legacy and new overlays coexist. The remaining
legacy body-portalled overlay implementation is `base/drawer`, with
`base/drawer-plus` wrapping it. It uses explicit z-index values:

| Layer                  | z-index      | Components                                                                                            |
| ---------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| Legacy Drawer shell    | `z-30`       | `base/drawer`, wrapped by `base/drawer-plus`                                                          |
| Legacy Drawer backdrop | `z-40`       | `base/drawer`, wrapped by `base/drawer-plus`                                                          |
| Legacy Drawer popup    | `z-50`       | `base/drawer`, wrapped by `base/drawer-plus`                                                          |
| **New UI primitives**  | **`z-1002`** | `@langgenius/dify-ui/*` (Drawer, Popover, PreviewCard, Dialog, Autocomplete, Combobox, Tooltip, etc.) |
| Toast                  | `z-1003`     | `@langgenius/dify-ui/toast`                                                                           |

`z-1002` sits above the remaining legacy drawer popup, so new primitives always
render on top without needing per-call-site z-index hacks. Dropping new
primitives to `z-50` while these drawers still exist would put new overlays on
the same layer as the legacy drawer popup and make cross-portal ordering depend
on DOM order instead of a clear contract.

Among themselves, new primitives share the same z-index and rely on **DOM
order** for stacking (later portal = on top).

Toast stays one layer above the overlay primitives so notifications remain
visible above dialogs, popovers, and other portalled surfaces without falling
back to `z-9999`.

### Current inventory

- `packages/dify-ui/src/*` still owns the body-portalled overlay layer:
  `Dialog`, `AlertDialog`, `Autocomplete`, `Combobox`, `ContextMenu`,
  `Drawer`, `DropdownMenu`, `Popover`, `PreviewCard`, `Select`, and `Tooltip`
  use `z-1002`; `Toast` uses `z-1003`.
- `web/app/components/base/drawer` is still present and portals to
  `document.body`; `web/app/components/base/drawer-plus` wraps it.
- Production imports of the deprecated drawer APIs still exist under `web/`.
  No `web/app/components/base/modal` or `web/app/components/base/dialog`
  implementation remains in the current tree.
- `web/app/components/billing/pricing/plans/cloud-plan-item/index.tsx` contains
  one standalone `z-1002` backdrop next to a new `AlertDialog`. It is not a
  body-portal primitive override, so it does not change the body overlay layer
  decision, but it should be removed or rechecked when the actual z-index
  reduction happens.

### Rules

- **Do NOT add z-index overrides** (e.g. `className="z-1003"`) on new
  `@langgenius/dify-ui/*` components. If you find yourself needing one, the
  parent legacy overlay should be migrated instead.
- When migrating a legacy overlay that has a high z-index, remove the z-index
  entirely — the new primitive's default `z-1002` handles it.
- When using Base UI trigger `render`, render a real `button` for button-like
  triggers. If the trigger must render a non-button element, the primitive must
  explicitly opt out of the native button behavior where that API is available.

### Post-migration cleanup

Once all legacy overlays are removed:

1. Confirm there are no production imports of `@/app/components/base/drawer` or
   `@/app/components/base/drawer-plus`.
1. Confirm no body-portalled legacy overlay remains outside
   `@langgenius/dify-ui/*`.
1. Remove or recheck any standalone `z-1002` web call sites that were paired
   with migrated overlays.
1. Reduce `z-1002` back to `z-50` across all `@langgenius/dify-ui/*` primitives.
1. Reduce Toast from `z-1003` to `z-51`.
1. Remove this section from the migration guide.

[`packages/dify-ui/README.md`]: ../../packages/dify-ui/README.md
