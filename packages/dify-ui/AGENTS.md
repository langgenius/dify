# @langgenius/dify-ui

Shared design tokens, the `cn()` utility, a Tailwind CSS preset, and headless primitive components consumed by `web/`.

## Component Authoring Rules

- Use `@base-ui/react` primitives + `cva` + `cn`.
- Inside dify-ui, cross-component imports use relative paths (`../button`). External consumers use subpath exports (`@langgenius/dify-ui/button`).
- No imports from `web/`. No dependencies on next / i18next / ky / jotai / zustand.
- One component per folder: `src/<name>/index.tsx`, optional `index.stories.tsx` and `__tests__/index.spec.tsx`. Add a matching `./<name>` subpath to `package.json#exports`.
- Props pattern: `Omit<BaseXxx.Root.Props, 'className' | ...> & VariantProps<typeof xxxVariants> & { /* custom */ }`.
- When a component accepts a prop typed from a shared internal module, `export type` it from that component so consumers import it from the component subpath.

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
