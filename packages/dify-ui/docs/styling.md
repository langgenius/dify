# Styling

## Tailwind CSS v4

Import Tailwind from the consumer's root stylesheet as described in the [Tailwind CSS v4 upgrade
guide], then import the Dify UI CSS entry:

```css
@import 'tailwindcss';
@import '@langgenius/dify-ui/styles.css';
```

When a workspace consumer scans Dify UI source directly, add an `@source` entry for the package's
`src/` directory using [Tailwind CSS functions and directives], resolved from that consumer
stylesheet:

```css
/* Example only: resolve paths from this stylesheet. */
@source '../../../packages/dify-ui/src';
@source not '../../../packages/dify-ui/src/**/*.{spec,test}.{ts,tsx}';
@source not '../../../packages/dify-ui/src/**/*.stories.{ts,tsx}';
```

## Figma radius mapping

Figma radius tokens are offset by one step from Tailwind CSS v4 defaults. Use this mapping instead
of adding custom theme values or `radius-*` utilities:

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

Convert Figma output such as `rounded-[var(--radius/sm, 6px)]` to the mapped Tailwind class. Use an
arbitrary value only when no standard class matches.

Use semantic Dify tokens and existing component variants before hard-coded values or repeated
primitive classes. Use an important modifier only for a tightly scoped compatibility override
after the owning variant, data attribute, and selector structure cannot express the state.

Attach focus-visible styling to the element that visually represents focus. If a visible wrapper
contains the native focus target, select that descendant state from the wrapper; for example,
`SliderThumb` uses `has-[:focus-visible]` because its internal range input receives focus.

[Tailwind CSS functions and directives]: https://tailwindcss.com/docs/functions-and-directives
[Tailwind CSS v4 upgrade guide]: https://tailwindcss.com/docs/upgrade-guide
