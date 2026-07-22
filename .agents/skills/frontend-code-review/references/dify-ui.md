# Dify UI Rules

Use these rules whenever a review touches `packages/dify-ui/` or code consuming `@langgenius/dify-ui/*`.

Before finalizing findings for those files, read the current local docs that apply:

- `packages/dify-ui/README.md`
- `packages/dify-ui/AGENTS.md`
- `web/docs/overlay.md` for floating UI
- `packages/dify-ui/src/<primitive>/index.tsx` for the primitive being changed or consumed

## Package Boundary

Flag in `packages/dify-ui`:

- Imports from `web/`.
- Dependencies on Next.js, i18n, ky, Jotai, Zustand, TanStack Query, oRPC, or business APIs.
- Business-specific component behavior that belongs in `web/`.
- Multiple unrelated primitives in one component folder.

`packages/dify-ui` is a primitive layer: Base UI headless components + `cva` + `cn` + Dify design tokens.

## Imports And Exports

Flag:

- Consumer imports from `@langgenius/dify-ui` without a subpath.
- Missing `package.json#exports` entry for a new primitive.
- Internal package imports using workspace subpaths instead of relative paths.
- Exported props using internal-only types that consumers cannot import from the component subpath.
- Canonical primitive boundaries or their associated public types using a redundant `Root` suffix when no higher-level convenience component exists in the same subpath.

Consumers use subpath exports such as `@langgenius/dify-ui/button`.

Canonical boundaries use the primitive name and matching public types (`Select` / `SelectProps`). Keep `Root` only to distinguish a low-level anatomy root from a higher-level convenience component (`CheckboxRoot` / `Checkbox`); implementation aliases should still show their Base UI source (`BaseSelect.Root.Props`).

## Props And State

Flag:

- Flattened props where related values need a discriminated union, such as `value` / `defaultValue`, `multiple` / `value`, or `clearable` / `onChange`.
- React state used only to mirror Base UI state for class names.
- JavaScript conditional class logic for visual states that the Dify UI/Base UI primitive already exposes through `data-*` attributes or CSS variables.
- Controlled props added when uncontrolled DOM state or CSS variables would be enough.
- Thin wrappers that rename Base UI parts without adding semantics.
- Generic Base UI selection primitives wrapped without preserving their value generics, such as `Select.Root<Value, Multiple>`, `RadioGroup<Value>`, or `Radio.Root<Value>`.
- Shared select/radio option components that type selected values as `string` while callers pass enums, unions, booleans, numbers, objects, or nullable placeholder values.

Prefer Base UI/Dify UI data attributes and CSS variables for visual state: `data-open`, `data-checked`, `data-disabled`, `data-highlighted`, `data-popup-open`, `group-data-*`, `peer-data-*`, `has-[:focus-visible]`, and primitive CSS variables such as anchor width or transform origin. Use JS conditional classes for product/business state that the primitive does not expose.

For non-string `Select` and `RadioGroup` values, prefer explicit domain generics at the root and at child value carriers. JSX children do not inherit the parent generic, so `RadioGroup<PromptMode>` should compose with `Radio<PromptMode>`, `RadioItem<PromptMode>`, or option values from a typed collection. For `Select`, prefer the Base UI `items` collection pattern for typed value-to-label rendering, and flag string coercion helpers used only to recover display labels.

## Forms

Flag:

- Form-like UI using unrelated `Input` and `Button` pieces without a submit boundary.
- Text-like fields not composed through `Field`, `FieldLabel`, and `FieldControl` when using Dify UI form semantics.
- Select fields using `FieldLabel` instead of `SelectLabel`.
- Slider fields using a generic label instead of `SliderLabel`.
- Checkbox/radio groups missing `Fieldset` and `FieldsetLegend`.
- Field errors or descriptions rendered without `FieldDescription` / `FieldError` relationships.

`Form` is the submit boundary. Dify UI form primitives are not a form state-management framework; business validation and schema-driven behavior belong in `web/`.

## Overlay Contract

Flag:

- Legacy web overlay imports in new or modified code.
- Manual portals around Dify UI overlay primitives.
- Call-site `z-*` overrides on overlays.
- Missing root `isolation: isolate` assumptions when debugging overlay stacking.
- Repeated backdrop, z-index, or portal chrome at call sites.
- Tooltip used for infotips, long text, or interactive content.

All Dify UI body-portalled overlays use `z-50`. Toast uses `z-60`. DOM order handles stacking between overlays.

## Primitive Selection

Flag:

- `Tabs` used for simple mode/filter/view selection where `SegmentedControl` is the semantic primitive.
- `SegmentedControl` used where `tablist` / `tabpanel` semantics are required.
- `Select` used for searchable or free-form input.
- `Combobox` used for unrestricted search text where no selected option is remembered.
- `Autocomplete` used for closed-list selection.
- Tooltip or PreviewCard used for content that must be reachable on touch or by screen readers.

Use:

- `Autocomplete` for free-form text with optional suggestions.
- `Combobox` for searchable selected values from a collection.
- `Select` for closed, scannable option sets.
- `Popover` for infotips, help text, rich content, or interactions.

## Bad Usage Patterns To Flag

Flag:

- Manually recreating UI behavior or chrome already owned by `@langgenius/dify-ui/*` or `web/app/components/base/*`, such as buttons, inputs, toggle groups, popovers, dropdown menus, alert dialogs, switches, avatars, scroll areas, toasts, borders, focus states, disabled states, segmented controls, or existing feature components.
- Styling a raw Base UI primitive directly in `web/` when a Dify UI primitive exists.
- Wrapping a Dify UI primitive in a feature component that hides its label, error, disabled, or focus contract.
- Replacing a semantic primitive with a generic `div` plus classes to match a screenshot.
- Using `Tooltip` because it is visually convenient when the content is actually help text or needs touch access.
- Adding a `z-*` override to make a child popup appear over a parent dialog.
- Adding a new app-level wrapper around Dialog, Drawer, Popover, Select, or Combobox that repeats portal/backdrop/positioner logic.
- Using dify-ui `Input` as a drop-in replacement for legacy inputs that include search, clear, copy, unit, localized placeholder, or number normalization behavior.
- Building a form row from loose text and controls instead of the matching Field/Form primitives.
- Adding component state only to style `data-open`, `data-checked`, `data-disabled`, or highlighted states that Base UI already exposes.
- Passing booleans down only so children can toggle classes already expressible with primitive `data-*` selectors.

## Tokens, Radius, And Styling

Flag:

- `radius-*` class names.
- Custom Tailwind `borderRadius` extension for Figma radius values.
- Generic colors where semantic Dify tokens exist.
- Hardcoded design values where Dify tokens, component variants, or documented Figma radius mappings exist.
- `!` important modifiers used to fight primitive styles instead of fixing the variant, selector, or component composition.
- Manual class strings that duplicate primitive variants.
- `min-w-(--anchor-width)` on picker popups when it defeats viewport clamping.

Use the Figma radius mapping from `packages/dify-ui/AGENTS.md`; for example `--radius/sm` maps to `rounded-md`, and `--radius/md` maps to `rounded-lg`.

Use `!` only for a tightly scoped compatibility override after confirming the primitive API, data attributes, and selector structure cannot express the state.

## Focus Details

Flag focus rings attached to the wrong element. For example, Base UI `Slider.Thumb` focuses an internal `input[type=range]`, so the visible thumb wrapper needs `has-[:focus-visible]` rather than direct wrapper `focus-visible`.

## Custom SVG Icons

Flag:

- New generated React icon components or JSON files under `web/app/components/base/icons/src/...` for custom SVG icons.
- Custom SVG icons consumed outside the Tailwind `i-custom-*` icon class pipeline.
- Generated `packages/iconify-collections/custom-*/icons.json` diffs where unrelated existing icons lost or changed intrinsic `width` or `height`.

New custom SVG icons belong in `packages/iconify-collections/assets/...`. Regenerate with `pnpm --filter @dify/iconify-collections generate`, validate with `pnpm --filter @dify/iconify-collections check:dimensions`, and consume the generated icon with Tailwind `i-custom-*` classes.
