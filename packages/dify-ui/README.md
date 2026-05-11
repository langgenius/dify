# @langgenius/dify-ui

Shared UI primitives, design tokens, CSS-first Tailwind styles, and the `cn()` utility consumed by Dify's `web/` app.

The primitives are thin, opinionated wrappers around [Base UI] headless components, styled with `cva` + `cn` and Dify design tokens.

> `private: true` — this package is consumed by `web/` via the pnpm workspace and is not published to npm. Treat the API as internal to Dify, but stable within the workspace.

## Installation

Already wired as a workspace dependency in `web/package.json`. Nothing to install.

For a new workspace consumer, add:

```jsonc
{
  "dependencies": {
    "@langgenius/dify-ui": "workspace:*"
  }
}
```

## Imports

Always import from a **subpath export** — there is no barrel:

```ts
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Drawer, DrawerPopup, DrawerTrigger } from '@langgenius/dify-ui/drawer'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import '@langgenius/dify-ui/styles.css' // once, in the app root
```

Importing from `@langgenius/dify-ui` (no subpath) is intentionally not supported — it keeps tree-shaking trivial and makes Storybook / test coverage attribution per-primitive.

## Primitives

| Category | Subpath                                                                                                                                                        | Notes                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Overlay  | `./alert-dialog`, `./autocomplete`, `./combobox`, `./context-menu`, `./dialog`, `./drawer`, `./dropdown-menu`, `./popover`, `./select`, `./toast`, `./tooltip` | Portalled. See [Overlay & portal contract] below. |
| Form     | `./autocomplete`, `./combobox`, `./number-field`, `./slider`, `./switch`                                                                                       | Controlled / uncontrolled per Base UI defaults.   |
| Layout   | `./scroll-area`                                                                                                                                                | Custom-styled scrollbar over the host viewport.   |
| Media    | `./avatar`, `./button`                                                                                                                                         | Button exposes `cva` variants.                    |

Utilities:

- `./cn` — `clsx` + `tailwind-merge` wrapper. Use this for conditional class composition.
- `./styles.css` — the one CSS entry that ships the design tokens, theme variables, and project utilities/components. Import it once from the app root.

## Tailwind CSS v4 integration

This package uses Tailwind CSS v4's CSS-first configuration model. Consumers should import Tailwind from their own root stylesheet, then import this package's CSS entry:

```css
@import 'tailwindcss';
@import '@langgenius/dify-ui/styles.css';
```

If a consumer uses Dify UI source files through the workspace, add an explicit source so Tailwind can detect utility classes:

```css
@source '../packages/dify-ui/src';
```

## Overlay & portal contract

Overlay primitives render their floating surfaces inside a [Base UI Portal] attached to `document.body`. This is the Base UI default — see the upstream [Portals][Base UI Portal] docs for the underlying behavior. Convenience content components such as `DialogContent`, `PopoverContent`, and `SelectContent` own their portal internally; primitives with explicit portal anatomy such as `Drawer` expose the matching `DrawerPortal` part so consumers can compose the full Base UI structure.

### Root isolation requirement

The host app **must** establish an isolated stacking context at its root so the portalled overlay layer is not clipped or re-ordered by ancestor `transform` / `filter` / `contain` styles. In the Dify web app this is done in `web/app/layout.tsx`:

```tsx
<body>
  <div className="isolate h-full">{children}</div>
</body>
```

Equivalent: any root element with `isolation: isolate` in CSS. Without it, overlays can be visually clipped on Safari when a descendant creates a new stacking context.

### z-index layering

Every overlay primitive uses a single, shared z-index. Do **not** override it at call sites.

| Layer                                                                                                               | z-index | Where                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| Overlays (Dialog, AlertDialog, Autocomplete, Combobox, Drawer, Popover, DropdownMenu, ContextMenu, Select, Tooltip) | `z-50`  | Positioner / Backdrop                                                      |
| Toast viewport                                                                                                      | `z-60`  | One layer above overlays so notifications are never hidden under a dialog. |

Rationale: Dify UI owns the normal application overlay layer. Overlay primitives share `z-50` and **rely on DOM order** for stacking — the portal mounted later wins. Toast owns `z-60` so notifications remain visible above dialogs, popovers, and other portalled surfaces without falling back to `z-9999`.

See `[web/docs/overlay.md](../../web/docs/overlay.md)` for the web app overlay best practices.

### Rules

- Never add ad hoc `z-*` overrides on primitives from this package. If something is getting clipped, fix the parent overlay structure instead of raising the child primitive.
- Never create an extra manual portal on top of our primitives — use the exported content / portal parts such as `DialogContent`, `PopoverContent`, and `DrawerPortal`. Base UI handles focus management, scroll-locking, and dismissal.
- When a primitive needs additional presentation chrome (e.g. a custom backdrop), add it **inside** the exported component, not at call sites.

### Tooltip, infotip, and popover semantics

- Use `Tooltip` only for short, non-interactive visual labels. The trigger must already have visible text or an `aria-label`; the tooltip is not the accessible name and must not contain links, buttons, forms, or structured prose.
- Use `Popover` for explanatory content, long text, rich layout, or anything users may need to reach on touch or with assistive technology. In `web/`, the `Infotip` wrapper is the preferred pattern for a `?` help glyph backed by `Popover`.
- Pick a `placement` and let the primitive own spacing. Avoid per-call-site offsets unless the component API explicitly needs a measured layout exception.
- When passing a Base UI trigger `render` prop, render a real `<button type="button">` for button-like triggers. If a Popover trigger must render a `div`, `span`, or another non-button element, pass `nativeButton={false}`.

## Development

- `pnpm -C packages/dify-ui test` — Vitest unit tests for primitives.
- `pnpm -C packages/dify-ui storybook` — Storybook on the default port. Each primitive has `index.stories.tsx`.
- `pnpm -C packages/dify-ui type-check` — `tsgo --noEmit` for this package only.

### Disabling Animations In Tests

Base UI can wait for `element.getAnimations()` to finish before it unmounts overlays, panels, and transition-driven components. Browser-based test runners can make that timing unstable, especially when tests assert final DOM state rather than animation behavior.

Set the Base UI test flag in a Vitest setup file to skip those waits:

```ts
(
  globalThis as typeof globalThis & {
    BASE_UI_ANIMATIONS_DISABLED: boolean
  }
).BASE_UI_ANIMATIONS_DISABLED = true
```

`packages/dify-ui/vitest.setup.ts` already applies this for primitive tests.

See `[AGENTS.md](./AGENTS.md)` for:

- Component authoring rules (one-component-per-folder, `cva` + `cn`, relative imports inside the package, subpath imports from consumers).
- Figma `--radius/`* token → Tailwind `rounded-*` class mapping.

## Not part of this package

- Application state (`jotai`, `zustand`), data fetching (`ky`, `@tanstack/react-query`, `@orpc/*`), i18n (`next-i18next` / `react-i18next`), and routing (`next`) all live in `web/`. This package has zero dependencies on them and must stay that way so it can eventually be consumed by other apps or extracted.
- Business components (chat, workflow, dataset views, etc.). Those belong in `web/app/components/...`.

[Base UI Portal]: https://base-ui.com/react/overview/quick-start#portals
[Base UI]: https://base-ui.com/react
[Overlay & portal contract]: #overlay--portal-contract
