# Separator

A static separator built on [Base UI Separator]. By default, it exposes `role="separator"`
and its orientation to assistive technology. Use it for meaningful boundaries between content
or action groups. Set `decorative` for purely visual lines, such as title ornaments and skeleton
lines; these do not expose separator semantics.

```tsx
import { Separator } from '@langgenius/dify-ui/separator'

<Separator className="my-4" />
<Separator decorative orientation="vertical" className="mx-2 h-4" />
<Separator decorative variant="gradient" />
```

Keep static separators out of the tab order; they do not require an accessible name. This component
does not implement the keyboard interaction or value semantics of a resizable separator.
Keep headings and labels beside the separator, since descendants of `role="separator"` have
presentational semantics. Use the owning menu family's separator inside menus.

Follow the shared [styling contract] for state callbacks. Custom render
components must forward the received props and ref. Explicit DOM props and render overrides can
change the default semantics; callers are responsible for keeping those overrides consistent
with the intended role and `decorative` setting.

Lines are 1px thick with no built-in margins. `variant` accepts `solid` (the default) or
`gradient` (a left-to-right fade). Callers control spacing, length, and placement through layout
and `className`: width sets a horizontal line's length; height sets a vertical line's length.
Use `variant` for the gradient rather than repeating its styles. To customize color, use a
background token for solid lines or a gradient-start token for gradient lines.

[Base UI Separator]: https://base-ui.com/react/components/separator
[styling contract]: ../../docs/styling.md
