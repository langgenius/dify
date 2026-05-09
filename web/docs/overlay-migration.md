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
**`z-50`**, except Toast which stays above overlays at **`z-60`**.

This section compares only overlay surfaces that portal to `document.body`.
Regular React-tree layers such as sticky headers, canvas chrome, editor helper
panels, and other in-tree `z-*` values are outside this overlay stacking
contract.

### Why z-50 now?

As of 2026-05-09, the `@langgenius/dify-ui/*` primitives no longer need the
temporary high layer that was used while `base/modal`, `base/dialog`,
`base/drawer`, and `base/drawer-plus` were being migrated.

During the remaining migration period, legacy drawer implementations can still
coexist with new primitives. The correct fix is to migrate the legacy parent or
the nested child that needs to escape it, not to raise the shared Dify UI layer.

| Layer                  | z-index    | Components                                                                                            |
| ---------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| Legacy Drawer shell    | `z-30`     | `base/drawer`, wrapped by `base/drawer-plus`                                                          |
| Legacy Drawer backdrop | `z-40`     | `base/drawer`, wrapped by `base/drawer-plus`                                                          |
| Legacy Drawer popup    | `z-50`     | `base/drawer`, wrapped by `base/drawer-plus`                                                          |
| **New UI primitives**  | **`z-50`** | `@langgenius/dify-ui/*` (Drawer, Popover, PreviewCard, Dialog, Autocomplete, Combobox, Tooltip, etc.) |
| Toast                  | `z-60`     | `@langgenius/dify-ui/toast`                                                                           |

New primitives share the same z-index and rely on **DOM order** for stacking
(later portal = on top). When a legacy drawer opens a nested new overlay, the
new overlay should be portalled after the parent interaction and appear above it
without a per-call-site z-index override. If that is not true, migrate the
legacy drawer path instead of raising the primitive.

Toast stays one layer above the overlay primitives so notifications remain
visible above dialogs, popovers, and other portalled surfaces without falling
back to `z-9999`.

### Current inventory

- `packages/dify-ui/src/*` still owns the body-portalled overlay layer:
  `Dialog`, `AlertDialog`, `Autocomplete`, `Combobox`, `ContextMenu`,
  `Drawer`, `DropdownMenu`, `Popover`, `PreviewCard`, `Select`, and `Tooltip`
  use `z-50`; `Toast` uses `z-60`.
- `web/app/components/base/drawer` is still present and portals to
  `document.body`; `web/app/components/base/drawer-plus` wraps it.
- Production imports of the deprecated drawer APIs still exist under `web/`.
  No `web/app/components/base/modal` or `web/app/components/base/dialog`
  implementation remains in the current tree.
- `web/app/components/billing/pricing/plans/cloud-plan-item/index.tsx` no
  longer renders a standalone backdrop next to `AlertDialog`; the primitive owns
  the backdrop and focus behavior.
- `web/app/components/tools/edit-custom-collection-modal/config-credentials.tsx`
  now uses `@langgenius/dify-ui/drawer`, so its previous nested
  `z-60` / `z-70` / `z-80` override is gone.

### Rules

- **Do NOT add z-index overrides** (e.g. `className="z-9999"`) on new
  `@langgenius/dify-ui/*` components. If you find yourself needing one, the
  parent legacy overlay should be migrated instead.
- When migrating a legacy overlay that has a high z-index, remove the z-index
  entirely — the new primitive's default `z-50` handles it.
- When using Base UI trigger `render`, render a real `button` for button-like
  triggers. If the trigger must render a non-button element, the primitive must
  explicitly opt out of the native button behavior where that API is available.

### Post-migration cleanup

Continue the cleanup with source-level inventory, not by raising the shared
layer:

1. Confirm there are no production imports of `@/app/components/base/drawer` or
   `@/app/components/base/drawer-plus`.
1. Confirm no body-portalled legacy overlay remains outside
   `@langgenius/dify-ui/*`.
1. Remove any remaining standalone overlay backdrops paired with migrated
   primitives.
1. Keep the Dify UI overlay layer at `z-50` and Toast at `z-60`.
1. Remove this section from the migration guide.

[`packages/dify-ui/README.md`]: ../../packages/dify-ui/README.md
