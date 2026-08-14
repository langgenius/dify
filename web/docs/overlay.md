# Overlay Best Practices

Use `@langgenius/dify-ui/*` primitives for ordinary overlays in new and modified web code. Choose by interaction semantics, not visual shape. A feature may compose business content around a primitive, but it must not recreate generic portal, backdrop, positioning, focus, or z-index behavior.

## Primitive choice

- Use `Dialog` for modal surfaces that need focus containment, scroll locking, Escape handling, and outside-press dismissal.
- Use `AlertDialog` only when a destructive or must-confirm decision requires an explicit response.
- Use `Drawer` for side panels and setup or editor surfaces that follow the drawer interaction model.
- Use `DropdownMenu` for a button-triggered action list and `ContextMenu` for pointer-context actions.
- Choose `Select`, `Combobox`, or `Autocomplete` by the [Dify UI search and picker contract], not because each renders a popup.
- Use `Popover` or the web `Infotip` wrapper for explanatory content, long help text, rich layout, or interactive content.
- Use `Tooltip` only for a short, non-interactive visual label. Its trigger must already have an accessible name.
- Use `PreviewCard` only as a non-interactive visual preview of a link destination. Essential information must remain available without the preview.

## Composition

- Prefer the most specific semantic primitive over styling a generic `Dialog`.
- Use controlled `open` and `onOpenChange` when business state, analytics, or cleanup reacts to visibility; otherwise let the primitive own its state.
- For a button-like overlay trigger, keep the state-owning primitive outside and use its `render` prop to render the final `Button` or `IconButton`. Do not mirror open, pressed, or expanded state in the button.
- Use the primitive-owned content or portal part. Do not wrap a Dify UI overlay in another manual portal.
- Keep shared overlay chrome in Dify UI and feature-specific content in the feature owner.

## Feature-owned exception

The Step-by-step Tour coachmark is a deliberate feature-owned overlay because it targets arbitrary route content and owns spotlight geometry, pointer blockers, and target interaction policy. Its manual portal belongs to `web/app/components/step-by-step-tour/coachmark.tsx`; it is not a general overlay primitive or a pattern for ordinary dialogs and popovers.

## Layering

Body-portalled Dify UI overlays use `z-50`; Toast uses `z-60`. The app root keeps an isolated stacking context, and overlays at the same layer rely on DOM order.

Do not add call-site z-index overrides such as `z-9999`. If an overlay is clipped or hidden, fix the owning overlay structure instead of raising a child primitive.

[Dify UI search and picker contract]: ../../packages/dify-ui/README.md#search-and-picker-selection
