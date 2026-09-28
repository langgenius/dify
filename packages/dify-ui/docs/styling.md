# Styling

## Component state

Prefer the primitive's data attributes for state styling, such as `data-checked:` or
`data-disabled:`. Use its CSS variables for exposed dynamic values, such as popup anchor width
and available height. Do not mirror primitive state in React solely to style it.

Where supported by the upstream part, `className(state)` and `style(state)` read that part's state.
At call sites, before using a callback or React state to calculate styles, check whether data attributes or CSS
variables already express the requirement. When direct state access is needed, add a short comment
explaining why; for example, Tooltip and Popover can share `data-popup-open` on one trigger while
the style needs only Popover's open state. This does not restrict conditional rendering of content.

Composite content forwards these callbacks to its styled part: for example, `PopoverContent`
receives Popup state, not Positioner state. Native DOM props and custom convenience APIs do not
automatically support state callbacks.

Use `render` for element composition, not merely to change styles. A callback on `PopoverTrigger`
reads Popover state; one on a standalone `Button` reads Button state. Composition does not change
which state a part owns.

With `render={<Button />}`, Base UI automatically merges the target's props without resolving
its callbacks. Put callbacks on the outer primitive and use class strings and style objects on
that target. With `render={(props, state) => ...}`, forward the received props and ref, and explicitly
merge any custom classes, styles, or handlers. Do not switch to this form merely for state styling.
See Base UI's [styling] and [composition] guides for the upstream contracts.

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

## Border radius

Check the actual radius value in Figma before choosing a `rounded-*` class; matching token names
do not imply matching values. For example, `radius/sm = 6px` requires `rounded-md`, not
`rounded-sm` (4px). Prefer a standard Tailwind class with the matching value; use an arbitrary
value only when none matches, such as `rounded-[10px]` for 10px.

Use semantic Dify tokens and existing component variants before hard-coded values or repeated
primitive classes. Use an important modifier only for a tightly scoped compatibility override
after the owning variant, data attribute, and selector structure cannot express the state.

Attach focus-visible styling to the element that visually represents focus. If a visible wrapper
contains the native focus target, select that descendant state from the wrapper; for example,
`SliderThumb` uses `has-[:focus-visible]` because its internal range input receives focus.

[Tailwind CSS functions and directives]: https://tailwindcss.com/docs/functions-and-directives
[Tailwind CSS v4 upgrade guide]: https://tailwindcss.com/docs/upgrade-guide
[composition]: https://base-ui.com/react/handbook/composition
[styling]: https://base-ui.com/react/handbook/styling
