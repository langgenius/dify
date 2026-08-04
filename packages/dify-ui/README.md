# @langgenius/dify-ui

Shared UI primitives, design tokens, CSS-first Tailwind styles, and the `cn()` utility consumed by Dify's `web/` app.

The primitives are thin, opinionated wrappers around [Base UI] headless components, styled with `cva` + `cn` and Dify design tokens.
For upstream component docs, start from the [Base UI docs index].

> `private: true` — this package is consumed by `web/` via the pnpm workspace and is not published to npm. Treat the API as internal to Dify, but stable within the workspace.

## Installation

Already wired as a workspace dependency in `web/package.json`. Nothing to install.

For a new workspace consumer, add:

```jsonc
{
  "dependencies": {
    "@langgenius/dify-ui": "workspace:*",
  },
}
```

## Imports

Always import from a **subpath export** — there is no barrel:

```ts
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Drawer, DrawerPopup, DrawerTrigger } from '@langgenius/dify-ui/drawer'
import { Field, FieldControl, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { Textarea } from '@langgenius/dify-ui/textarea'
import '@langgenius/dify-ui/styles.css' // once, in the app root
```

Importing from `@langgenius/dify-ui` (no subpath) is intentionally not supported — it keeps tree-shaking trivial and makes Storybook / test coverage attribution per-primitive.

The canonical boundary exported from a primitive subpath uses the primitive name without a `Root` suffix, and its public types follow the same name (`Select` / `SelectProps`, `Drawer` / `DrawerProps`). Keep `Root` only when the subpath exposes both a low-level anatomy root and a higher-level convenience component, such as `CheckboxRoot` / `Checkbox` or `PaginationRoot` / `Pagination`. Implementation code should continue to reference the upstream Base UI anatomy explicitly through names such as `BaseSelect.Root.Props`.

### Public type contracts

Every runtime component exported from a primitive subpath must have an accurate, importable props type with the matching name (`DialogContent` / `DialogContentProps`). Define Dify-authored composite props at the Dify UI boundary; use direct aliases for unchanged Base UI parts instead of copying their shapes.

Treat each `src/<primitive>/index.tsx` as an explicit public API boundary. Keep component, factory, hook, and type declarations module-local, then publish the complete surface through separate `export { ... }` and `export type { ... }` manifests at the bottom of the file. Do not mix scattered inline exports with the manifest or use a wildcard export; omission from the manifest keeps implementation helpers private.

Preserve generic relationships end to end. Generic public components and their props must carry the same caller-owned type parameters, including picker `Value` / `Multiple`, form values, radio values, slider values, and overlay payloads and handles. Never erase those relationships with `any` or a hard-coded `string`; use `unknown` only as the safe default for an independently consumed anatomy part whose value cannot be inferred from its parent through JSX.

Do not add a root-only generic when independently rendered JSX anatomy can produce values outside that root's inferred type. Preserve the upstream contract until the complete component family can enforce one value type; otherwise the generic gives callbacks a narrower type than the runtime can guarantee. `Tabs` intentionally follows Base UI's value contract for this reason.

Keep the public type surface smaller than the upstream Base UI namespace. A type is not public merely because Base UI provides a name for it, because Dify gives an internal contract a descriptive alias, or because an earlier implementation happened to export it. In addition to matching component props, export a type only when it pairs with a public factory or has a concrete workspace consumer that cannot express the contract clearly through the matching props type. Remove legacy aliases that have no matching runtime API or real consumer; package-local tests and stories can derive narrow values from canonical props instead of preserving an otherwise unused export. Dify-authored options, states, and controlled/uncontrolled branches stay private when the matching props type already expresses them.

State, event details and reasons, actions, and controlled/uncontrolled composition helpers are private by default. Public props already provide contextual typing for inline render and event callbacks. Export one of these narrower contracts only when Dify defines the state or event itself, a public factory requires the named type, or an external consumer needs to name it independently. Apply the same rule to Dify-authored components such as FileTree, Pagination, ProgressCircle, StatusDot, and Toast; being implemented locally does not justify a broader API.

Keep implementation-only render helpers, context values, styling helpers, and upstream passthrough aliases private. When a wrapper consumes `className` through `cn()`, omit the upstream state-callback form and expose `className?: string`; public types must describe behavior the wrapper actually implements.

## Primitives

| Category         | Subpath                                                                                                                                                       | Notes                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Actions          | `./button`                                                                                                                                                    | Design-system CTA primitive with `cva` variants.                                                      |
| Controls         | `./segmented-control`                                                                                                                                         | SegmentedControl for mode, filter, and view selection.                                                |
| Display          | `./collapsible`, `./kbd`                                                                                                                                      | Collapsible disclosure primitive; keyboard input and shortcut keycap primitives.                      |
| Feedback         | `./meter`, `./toast`                                                                                                                                          | Meter is inline status; Toast owns the `z-60` layer.                                                  |
| Form             | `./form`, `./field`, `./fieldset`, `./input`, `./textarea`, `./checkbox`, `./checkbox-group`, `./radio`, `./number-field`, `./select`, `./slider`, `./switch` | Native form boundary, field semantics, and controls.                                                  |
| Layout           | `./scroll-area`                                                                                                                                               | Custom-styled scrollbar over the host viewport.                                                       |
| Media            | `./avatar`                                                                                                                                                    | Avatar root, image, and fallback primitives.                                                          |
| Navigation       | `./file-tree`, `./pagination`, `./tabs`                                                                                                                       | FileTree for preview-oriented file disclosure lists; Pagination for page navigation; Tabs for panels. |
| Overlay / menu   | `./alert-dialog`, `./context-menu`, `./dialog`, `./drawer`, `./dropdown-menu`, `./popover`, `./preview-card`, `./tooltip`                                     | Portalled. See [Overlay & portal contract] below.                                                     |
| Search / pickers | `./autocomplete`, `./combobox`, `./select`                                                                                                                    | Search input, searchable picker, and closed picker.                                                   |

Utilities:

- `./cn` — `clsx` + `tailwind-merge` wrapper. Use this for conditional class composition.
- `./styles.css` — the one CSS entry that ships the design tokens, theme variables, and project utilities/components. Import it once from the app root.

## Button loading and disabled contract

`Button` keeps normal `disabled` controls native-disabled by default so unavailable actions are removed from the keyboard focus order.

When `loading` is true, `Button` defaults `focusableWhenDisabled` to true. Loading represents an action that has already been triggered and is temporarily pending, so the button remains focusable while Base UI still suppresses click, pointer, keyboard activation, and submit-button activation. Pass `focusableWhenDisabled={false}` only when a loading button should use native disabled behavior.

## Segmented control contract

`SegmentedControl` is Dify's design-system primitive for mode, filter, and view selection. It is built on Base UI `ToggleGroup` + `Toggle`, so use `Tabs` instead when the UI needs `tablist` / `tabpanel` semantics.

Its value contract follows Base UI: `value`, `defaultValue`, and `onValueChange` use arrays, and single-selection mode may report an empty array when the active item is toggled off.

## Form contract

Dify UI's form primitives are a Base UI composition layer for native form semantics, field accessibility, and design-system styling. They are intentionally not a form state-management framework. See the upstream [Base UI forms handbook], [Base UI Form], [Base UI Field], and [Base UI Fieldset] docs for the underlying component contracts.

Use `Form` for the submit boundary. It renders a native `<form>`, preserves Enter-to-submit and submit-button behavior, and adds Base UI's `onFormSubmit`, `errors`, `actionsRef`, and `validationMode` APIs for structured values and consolidated field validation. Prefer it over a bare `<form>` when the form is composed with Dify UI fields.

Use `Field` for each standalone named field. A field must have a stable `name`, a label relationship, and either a `FieldControl` or another control that participates in the same Base UI field context. Prefer a visible label for normal form rows; when the surrounding UI already supplies the visible text, use the matching label primitive visually hidden or put `aria-label` on the actual interactive control. `FieldDescription` and `FieldError` provide the message relationships that screen readers need, while the Dify wrapper adds the default Form Input Set styling from the design system.

Choose the label primitive by the control semantics. Text-like inputs, `Textarea`, input-based `Combobox` / `Autocomplete`, single `Checkbox` / `Radio`, `Switch`, and `NumberField` use `FieldLabel`. Trigger-based `Select` fields use `SelectLabel`; `Slider` fields use `SliderLabel`, with per-thumb `aria-label` only when the thumbs need distinct names. `SelectGroupLabel` and `AutocompleteGroupLabel` only label grouped options inside their popup content; they are not field labels.

Use `Fieldset` and `FieldsetLegend` when one field is represented by a group of related controls, such as checkbox groups, radio groups, multi-thumb sliders, or a section that combines several inputs. For checkbox and radio groups, wrap each option with `FieldItem` and give each option its own label:

```tsx
<Field name="allowedNetworkProtocols">
  <Fieldset render={<CheckboxGroup />}>
    <FieldsetLegend>Allowed network protocols</FieldsetLegend>
    <FieldItem>
      <FieldLabel className="flex items-center gap-2">
        <Checkbox value="https" />
        HTTPS
      </FieldLabel>
    </FieldItem>
  </Fieldset>
</Field>
```

`Fieldset` provides the group semantics and legend relationship. It does not own the interactive state of the grouped control. Pass `disabled`, `value`, `defaultValue`, and change handlers to the actual group primitive (`CheckboxGroup`, radio group, slider root, etc.) instead of relying on the fieldset wrapper to manage them.

## Typed value contracts

Selection primitives should preserve the caller's domain value type instead of widening values to `string`. Use `Select<Value, Multiple>`, `RadioGroup<Value>`, `Radio<Value>`, and `RadioItem<Value>` when the selected value is an enum, union, boolean, number, object, or nullable placeholder value.

Root-level generics type `value`, `defaultValue`, and value-dependent callbacks such as `onValueChange`. Upstream collection props such as `items` can still be broader than the root value type, and JSX children do not automatically inherit the parent generic. Type independently consumed anatomy parts when their value cannot be inferred locally; for non-string radio groups, type the child item too:

```tsx
<RadioGroup<PromptMode> value={promptMode} onValueChange={setPromptMode}>
  <Radio<PromptMode> value={PROMPT_MODE.default} />
  <RadioItem<PromptMode> value={PROMPT_MODE.custom}>
    <RadioControl />
    Custom prompt
  </RadioItem>
</RadioGroup>
```

Use `Radio` for the default Dify control. Use `RadioItem` when custom UI should be the radio item; place `RadioControl` inside it for the standard visual dot. `RadioControl` is a Dify visual part, not a Base UI anatomy export.

For `Select` and `Combobox`, a literal multiple-value contract must match the runtime mode: `<Combobox<Subject, true> multiple>`. Their value display can still receive `null` before a value is selected, including in multiple mode. Because JSX does not pass the root's generic to its children, repeat the domain type on independently consumed render anatomy instead of annotating callback parameters:

```tsx
<Combobox<Subject, true> multiple value={subjects} onValueChange={setSubjects}>
  <ComboboxValue<Subject, true>>
    {(selectedSubjects) => selectedSubjects?.map((subject) => subject.name).join(', ') ?? 'Anyone'}
  </ComboboxValue>
  <ComboboxList<Subject>>
    {(subject) => <ComboboxItem value={subject}>{subject.name}</ComboboxItem>}
  </ComboboxList>
</Combobox>
```

`AutocompleteList` follows the same rule. A `ComboboxGroup` or `AutocompleteGroup` can infer its local value type from `items`; a nested `Collection` is a separate JSX boundary and should use `<Value>` when its render callback needs the domain type. Dynamic `multiple={condition}` remains supported and gives callbacks the corresponding single-or-multiple union.

For select labels and display values, prefer the Base UI `items` collection pattern so the root, value display, and item list share one runtime source of truth for values and labels. Avoid helpers that stringify values only to recover labels later; convert values to strings only at real boundaries such as form submission, URL/search params, or legacy APIs that require strings.

`CheckboxGroup` follows the Base UI contract and uses `string[]`. Do not add a generic checkbox-group wrapper unless the underlying primitive contract changes; if different business IDs need stronger separation, model that at the feature/domain type boundary.

For complex business forms, keep state ownership outside these primitives. TanStack Form, zod, server validation, dialog reset behavior, and schema-driven rendering belong to the feature layer in `web/`; they should pass `name`, `invalid`, `dirty`, `touched`, `value`, `onValueChange`, and errors into these primitives rather than replacing the field semantics. In this repo, `web/app/components/base/form` is the TanStack/schema runtime adapter; `packages/dify-ui` remains the primitive layer.

Migration rule for `web/`: if a UI has a save/submit action, do not leave it as unrelated `Input` and `Button` pieces. Give it a real submit boundary with `Form` or a native `<form>`, attach visible field names through the appropriate label primitive (`FieldLabel`, `SelectLabel`, `SliderLabel`, or `FieldsetLegend`), expose helper/error text through `FieldDescription` / `FieldError`, and keep non-submit buttons as `type="button"`.

## Search and picker selection

Choose the primitive by its value contract:

- `Autocomplete` accepts free-form text with optional suggestions or completions.
- `Combobox` selects and remembers one or more values from a searchable collection.
- `Select` chooses from a closed, scannable list without text entry.

Keep Base UI anatomy visible in public APIs instead of wrapping a picker into one business component. Multiple-selection comboboxes follow the official chips composition: chips and input share the input group, chips wrap, and the group grows vertically. Autocomplete and Combobox popups own their portals, use the package overlay layer, and size from `--anchor-width` with viewport-aware maximum width; do not force a minimum width that defeats viewport clamping.

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

Figma radius tokens are offset by one step from Tailwind CSS v4 defaults. Use this mapping rather than adding custom theme values or `radius-*` utilities:

| Figma token     | Tailwind class   |
| --------------- | ---------------- |
| `--radius/2xs`  | `rounded-xs`     |
| `--radius/xs`   | `rounded-sm`     |
| `--radius/sm`   | `rounded-md`     |
| `--radius/md`   | `rounded-lg`     |
| `--radius/lg`   | `rounded-[10px]` |
| `--radius/xl`   | `rounded-xl`     |
| `--radius/2xl`  | `rounded-2xl`    |
| `--radius/3xl`  | `rounded-[20px]` |
| `--radius/6xl`  | `rounded-[28px]` |
| `--radius/full` | `rounded-full`   |

Convert Figma output such as `rounded-[var(--radius/sm, 6px)]` to the mapped Tailwind class. Use an arbitrary value only when no standard class matches.

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

### Tooltip, preview card, infotip, and popover semantics

- Use `Tooltip` only for short, non-interactive visual labels. The trigger must already have visible text or an `aria-label`; the tooltip is not the accessible name and must not contain links, buttons, forms, or structured prose.
- Use `PreviewCard` as a visual enhancement for a link that previews its destination. Its popup must remain non-interactive and must not contain unique or essential information unless that information is also available at the linked destination. Use `Popover` when opening the popup is the trigger's purpose or when users need to access its content on touch or with assistive technology.
- Use `Popover` for explanatory content, long text, rich layout, or anything users may need to reach on touch or with assistive technology. In `web/`, the `Infotip` wrapper is the preferred pattern for a `?` help glyph backed by `Popover`.
- Pick a `placement` and let the primitive own spacing. Avoid per-call-site offsets unless the component API explicitly needs a measured layout exception.
- When passing a Base UI trigger `render` prop, render a real `<button type="button">` for button-like triggers. If a Popover trigger must render a `div`, `span`, or another non-button element, pass `nativeButton={false}`.

## Development

- `vp check packages/dify-ui` (from the repository root) — formatting, lint, and TypeScript diagnostics for the package.
- `pnpm -C packages/dify-ui test` — Vitest unit tests for primitives.
- `pnpm -C packages/dify-ui storybook` — Storybook on the default port. Each primitive has `index.stories.tsx`.
- `pnpm -C packages/dify-ui test:storybook` — Storybook component tests in Vitest browser mode. Stories without `play` are render and a11y smoke tests; stories with `play` should cover public UI contracts such as opening overlays, keyboard navigation, disabled/loading guards, form submission, and controlled state updates.
- `pnpm -C packages/dify-ui type-check` — `tsgo --noEmit` for this package only.

### Test Boundary

Use Storybook tests for behavior that belongs to the documented component example:
visible state changes, user interaction, keyboard paths, overlay open/close flows,
and accessibility-facing semantics. Keep regular Vitest unit tests for lower-level
wrapper contracts such as class variants, Base UI passthrough props, hidden input
serialization, data attribute hooks, store behavior, and edge cases that do not
need a full story.

Storybook accessibility testing stays enabled globally with `a11y.test = 'error'`.
If a story is temporarily marked `todo`, keep the exception local to that story
and do not treat an interaction `play` test as a replacement for fixing the
underlying accessibility issue.

### Disabling Animations In Tests

Base UI can wait for `element.getAnimations()` to finish before it unmounts overlays, panels, and transition-driven components. Browser-based test runners can make that timing unstable, especially when tests assert final DOM state rather than animation behavior.

Set the Base UI test flag in a Vitest setup file to skip those waits:

```ts
;(
  globalThis as typeof globalThis & {
    BASE_UI_ANIMATIONS_DISABLED: boolean
  }
).BASE_UI_ANIMATIONS_DISABLED = true
```

`packages/dify-ui/vitest.setup.ts` already applies this for primitive tests.

See `[AGENTS.md](./AGENTS.md)` for:

- Component authoring rules (one-component-per-folder, `cva` + `cn`, relative imports inside the package, subpath imports from consumers).

## Not part of this package

- Application state (`jotai`, `zustand`), data fetching (`ky`, `@tanstack/react-query`, `@orpc/*`), i18n (`next-i18next` / `react-i18next`), and routing (`next`) all live in `web/`. This package has zero dependencies on them and must stay that way so it can eventually be consumed by other apps or extracted.
- Business components (chat, workflow, dataset views, etc.). Those belong in `web/app/components/...`.

[Base UI Field]: https://base-ui.com/react/components/field
[Base UI Fieldset]: https://base-ui.com/react/components/fieldset
[Base UI Form]: https://base-ui.com/react/components/form
[Base UI Portal]: https://base-ui.com/react/overview/quick-start#portals
[Base UI docs index]: https://base-ui.com/llms.txt
[Base UI forms handbook]: https://base-ui.com/react/handbook/forms
[Base UI]: https://base-ui.com/react
[Overlay & portal contract]: #overlay--portal-contract
