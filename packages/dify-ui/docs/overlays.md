# Overlays

Dify UI overlay primitives own their Base UI portals, normal application layer, positioning,
focus, modal behavior, and dismissal contracts. Consumers choose the semantic primitive and
compose its exported anatomy instead of recreating those responsibilities.

## Portals and root isolation

Floating surfaces render through [Base UI Portal] into `document.body`. Convenience components
such as `DialogContent`, `PopoverContent`, and `SelectContent` own their portals internally;
primitives with explicit anatomy expose the constituent portal and content parts.

The host must establish an isolated stacking context at its application root:

```tsx
<body>
  <div className="isolate h-full">{children}</div>
</body>
```

Equivalent CSS is [`isolation: isolate`][MDN `isolation`]. It creates a stacking context so
application descendants cannot use high z-index values to compete with sibling surfaces portalled
to `body`. Portalling avoids clipping by application ancestors; isolation itself does not fix
clipping.

## Layering

| Layer                                                                   | z-index |
| ----------------------------------------------------------------------- | ------- |
| Dialogs, pickers, drawers, menus, popovers, preview cards, and tooltips | `z-50`  |
| Toast viewport                                                          | `z-60`  |

Overlays at `z-50` rely on portal DOM order; the portal mounted later appears above earlier ones.
Toast remains one layer above ordinary overlays.

- Do not add call-site `z-*` overrides. Fix the owning overlay structure when content is clipped
  or hidden.
- Do not wrap a Dify UI overlay in another manual portal.
- Add shared backdrop or presentation chrome inside the owning exported component, not at call
  sites.

## Primitive semantics

- Use `Dialog` for modal content that needs focus containment and scroll locking.
- Use `AlertDialog` only for a destructive or must-confirm decision requiring an explicit answer.
- Use `Drawer` for side-panel interactions that follow the drawer model.
- Use `DropdownMenu` for button-triggered action lists and `ContextMenu` for context actions.
- Use [`Tooltip`] only for a short, non-interactive visual label. The trigger already needs an
  accessible name; use Popover for information users must reach on touch.
- Use [`PreviewCard`] as a non-interactive enhancement for a link destination. Essential
  information must also exist without the preview.
- Use [`Popover`] for explanatory, structured, or interactive content that users must reach on
  touch or with assistive technology.

Use a real `<button type="button">` for button-like triggers. If a Base UI trigger intentionally
renders a non-button element, set `nativeButton={false}`. Let the primitive own placement and
spacing unless its API documents a measured exception.

[Base UI Portal]: https://base-ui.com/react/overview/quick-start#portals
[MDN `isolation`]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/isolation
[`Popover`]: https://base-ui.com/react/components/popover
[`PreviewCard`]: https://base-ui.com/react/components/preview-card
[`Tooltip`]: https://base-ui.com/react/components/tooltip
