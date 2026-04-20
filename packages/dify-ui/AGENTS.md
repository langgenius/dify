# @langgenius/dify-ui

Shared design tokens, the `cn()` utility, a Tailwind CSS preset, and headless primitive components consumed by `web/`.

## Component Authoring Rules

- Use `@base-ui/react` primitives + `cva` + `cn`.
- Inside dify-ui, cross-component imports use relative paths (`../button`). External consumers use subpath exports (`@langgenius/dify-ui/button`).
- No imports from `web/`. No dependencies on next / i18next / ky / jotai / zustand.
- One component per folder: `src/<name>/index.tsx`, optional `index.stories.tsx` and `__tests__/index.spec.tsx`. Add a matching `./<name>` subpath to `package.json#exports`.
- Props pattern: `Omit<BaseXxx.Root.Props, 'className' | ...> & VariantProps<typeof xxxVariants> & { /* custom */ }`.
- When a component accepts a prop typed from a shared internal module, `export type` it from that component so consumers import it from the component subpath.

## Overlay Primitive Selection: Tooltip vs PreviewCard vs Popover

Three overlay primitives with distinct activation semantics and a11y contracts. Pick by the **trigger's primary click behavior** and **what the popup contains**, not by visual richness.

| Primitive     | Opens on                             | Trigger click is…       | Popup may contain interactive UI? | Touch / SR users reach content via |
| ------------- | ------------------------------------ | ----------------------- | --------------------------------- | ---------------------------------- |
| `Tooltip`     | hover / focus                        | no-op (or user-defined) | No — plain-text label only        | `aria-describedby` / label         |
| `PreviewCard` | hover / focus                        | **the primary action**  | No — static, supplementary only   | The trigger's click destination    |
| `Popover`     | click / press (and optionally hover) | toggles the popover     | Yes — unique actions allowed      | The popover itself (opened by tap) |

### When to use `PreviewCard`

Use when the trigger already owns its own primary click action (e.g. selecting a row, jumping to a definition, following a link) and you want to show a rich **supplementary** preview on hover/focus without hijacking the click.

**Hard a11y contract — enforce in review:**

- The popup MUST NOT contain information or actions that are not also reachable from the trigger's primary click destination. Touch and screen-reader users cannot open a `PreviewCard` — they must get the same content/actions by activating the trigger alone.
- If some content is unique to the preview, you have two compliant options:
  1. Add a separate click-triggered affordance next to the trigger (a `Popover` on an info/⋯ button) that opens the same rich panel, or
  1. Move the unique content onto the trigger's click destination and let the preview stay supplementary.
- Do not re-implement "hover to open" on top of `Popover` to work around this — the primitive split exists so the contract is explicit in the code.

### When to use `Popover`

Use when the popup owns its own interactions (forms, menus, unique actions) and the trigger's click is "open this popover". All users can reach popover content because opening it is the trigger's primary action.

### When to use `Tooltip`

Use for short plain-text labels/hints only (shortcut keys, truncated labels, icon-button names). Do not put interactive UI, images, or multiline rich content in a tooltip.

## Border Radius: Figma Token → Tailwind Class Mapping

The Figma design system uses `--radius/*` tokens whose scale is **offset by one step** from Tailwind CSS v4 defaults. When translating Figma specs to code, always use this mapping — never use `radius-*` as a CSS class, and never extend `borderRadius` in the preset.

| Figma Token     | Value | Tailwind Class   |
| --------------- | ----- | ---------------- |
| `--radius/2xs`  | 2px   | `rounded-xs`     |
| `--radius/xs`   | 4px   | `rounded-sm`     |
| `--radius/sm`   | 6px   | `rounded-md`     |
| `--radius/md`   | 8px   | `rounded-lg`     |
| `--radius/lg`   | 10px  | `rounded-[10px]` |
| `--radius/xl`   | 12px  | `rounded-xl`     |
| `--radius/2xl`  | 16px  | `rounded-2xl`    |
| `--radius/3xl`  | 20px  | `rounded-[20px]` |
| `--radius/6xl`  | 28px  | `rounded-[28px]` |
| `--radius/full` | 999px | `rounded-full`   |

### Rules

- **Do not** add custom `borderRadius` values to `tailwind-preset.ts`. We use Tailwind v4 defaults and arbitrary values (`rounded-[Npx]`) for sizes without a standard equivalent.
- **Do not** use `radius-*` as CSS class names. The old `@utility radius-*` definitions have been removed.
- When the Figma MCP returns `rounded-[var(--radius/sm, 6px)]`, convert it to the standard Tailwind class from the table above (e.g. `rounded-md`).
- For values without a standard Tailwind equivalent (10px, 20px, 28px), use arbitrary values like `rounded-[10px]`.
