# Icon Button

Use `IconButton` for a command represented by one icon and no visible text. Use [`Button`] when
the action has a visible label, including buttons with leading or trailing icons. Keep URL
navigation on a native link.

Dify UI `IconButton` is an opinionated [Base UI Button] with an accessible-name type contract and
icon-specific appearance, size, and tone variants.

## Accessible name and glyph

Every icon button must provide exactly one accessible-name source: `aria-label` or
`aria-labelledby`, preserving its [name, role, and value]. A tooltip is a visual enhancement, not
the button's accessible name.

Pass exactly one React element containing the decorative glyph and hide that glyph from the
accessibility tree:

```tsx
<IconButton aria-label="Close">
  <span aria-hidden="true" className="i-ri-close-line size-4" />
</IconButton>
```

The child owns the glyph and its optical size. `IconButton` owns the button size, radius,
colors, hover, disabled, and focus-visible styles. Use `className` for external layout or for
selectors driven by the composed primitive or business-state owner; do not recreate an existing
appearance variant.

Omit `variant` for the IconButton-specific neutral appearance. The other appearance names align
with `Button`. Use `tone="destructive"` for destructive intent.

## Composition

When Toggle, Menu, Popover, Tooltip, or Collapsible owns the interaction state, keep that
primitive outside and compose `IconButton` through its `render` prop. This preserves the owning
primitive's pressed, open, expanded, event, and ref behavior instead of mirroring that state on
the icon button.

## Related guides

- Read [`Button`] for visible-label actions, submit semantics, and loading state.
- Read [Base UI Button] for the upstream interaction and composition contract.

[Base UI Button]: https://base-ui.com/react/components/button
[`Button`]: ../button/README.md
[name, role, and value]: https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html
