# @langgenius/dify-ui

This package provides shared design tokens (colors, shadows, typography), the `cn()` utility, a Tailwind CSS preset, and a set of headless primitive components (Button, Dialog, Popover, ...) consumed by `web/`.

## Component Authoring Rules

- Prefer `@base-ui/react` as the headless primitive, styled with `cva` + `cn`.
- Inside dify-ui, cross-component imports MUST use relative paths (e.g. `import { Button } from '../button'`). Do NOT self-import via `@langgenius/dify-ui/*`.
- External consumers (e.g. `web/`) MUST import via subpath exports (e.g. `import { Button } from '@langgenius/dify-ui/button'`).
- Do NOT import anything from `web/` (no `@/*` aliases). dify-ui is a leaf package.
- Do NOT depend on next.js, react-i18next, ky, jotai, zustand, or other app-level runtime libraries. Keep components headless / framework-free.
- Icons: keep using the Tailwind `i-ri-*` / `i-heroicons-*` utilities. The `@egoist/tailwindcss-icons` plugin is configured at the host-app level; any component moved here will be picked up automatically because `web/tailwind.config.ts` already scans `packages/dify-ui/src/**`.
- Each component owns its folder: `src/<name>/index.tsx`, plus optional `index.stories.tsx` and `__tests__/index.spec.tsx`.
- Add a matching subpath to `package.json#exports`: `"./<name>": { "types": "./src/<name>/index.tsx", "import": "./src/<name>/index.tsx" }`.

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
