# @langgenius/dify-ui

Shared design tokens, the `cn()` utility, CSS-first Tailwind styles, and headless primitive components consumed by `web/`.

## Component Authoring Rules

- Use `@base-ui/react` primitives + `cva` + `cn`.
- Inside dify-ui, cross-component imports use relative paths (`../button`). External consumers use subpath exports (`@langgenius/dify-ui/button`).
- No imports from `web/`. No dependencies on next / i18next / ky / jotai / zustand.
- One component per folder: `src/<name>/index.tsx`, optional `index.stories.tsx` and `__tests__/index.spec.tsx`. Add a matching `./<name>` subpath to `package.json#exports`.
- Props pattern: `Omit<BaseXxx.Root.Props, 'className' | ...> & VariantProps<typeof xxxVariants> & { /* custom */ }`.
- When a component accepts a prop typed from a shared internal module, `export type` it from that component so consumers import it from the component subpath.

## Overlay Primitive Selection: Tooltip vs PreviewCard vs Popover

Pick by the **trigger's purpose** and **a11y reach**, not visual richness.

| Primitive     | Opens on              | Trigger's purpose          | Content                   | Reachable on touch / SR? |
| ------------- | --------------------- | -------------------------- | ------------------------- | ------------------------ |
| `Tooltip`     | hover / focus         | has its own action         | short plain-text label    | ❌ (label only)          |
| `PreviewCard` | hover / focus         | has a primary click target | supplementary preview     | ❌ (via click target)    |
| `Popover`     | click / tap (+ hover) | **to open the popup**      | anything, incl. long text | ✅                       |

Base UI decision rule ([docs]):

> _"If the trigger's purpose is to open the popup itself, it's a popover.
> If the trigger's purpose is unrelated to opening the popup, it's a tooltip."_

Apply this first, then narrow:

- `Tooltip` — ephemeral visual label. Trigger must already carry its own `aria-label` / visible text; tooltip mirrors it for sighted mouse/keyboard users. No interactive UI, no multi-line prose. Not dwell-able.
- `PreviewCard` — hover-revealed rich supplementary preview anchored to a trigger whose click goes somewhere (link, selectable row, jumpable chip). **Hard contract:** the popup MUST NOT contain information or actions unreachable from the trigger's click destination — touch and SR users can't open it. If the info is unique to the popup, switch to `Popover` (click or `openOnHover`) or move it to the click destination. Do not hand-roll "hover to open" on top of `Popover` to evade this split.
- `Popover` — any popup with its own interactions, or any "infotip" (`?` / `(i)` glyph whose sole purpose is to reveal help text). Pass `openOnHover` on `PopoverTrigger` for the infotip case — unlike `Tooltip` / `PreviewCard`, this stays accessible to touch and SR users because the popover still opens on tap and focus.

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

- **Do not** add custom `borderRadius` theme values. We use Tailwind v4 defaults and arbitrary values (`rounded-[Npx]`) for sizes without a standard equivalent.
- **Do not** use `radius-*` as CSS class names. The old `@utility radius-*` definitions have been removed.
- When the Figma MCP returns `rounded-[var(--radius/sm, 6px)]`, convert it to the standard Tailwind class from the table above (e.g. `rounded-md`).
- For values without a standard Tailwind equivalent (10px, 20px, 28px), use arbitrary values like `rounded-[10px]`.

[docs]: https://base-ui.com/react/components/tooltip#infotips
