# Overlay Best Practices

Use `@langgenius/dify-ui/*` primitives for overlays in new and modified web
code. Do not import raw Base UI overlays or legacy web overlays from
`@/app/components/base/modal`, `@/app/components/base/dialog`, or
`@/app/components/base/drawer`.

## Primitive choice

- Use `@langgenius/dify-ui/dialog` for modal surfaces that need focus
  management, scroll locking, escape handling, and outside-press dismissal.
- Use `@langgenius/dify-ui/alert-dialog` only for destructive or must-confirm
  decisions.
- Use `@langgenius/dify-ui/drawer` for side panels, setup panels, and nested
  editor panels that must behave like a drawer. Do not add separate web drawer
  wrappers.
- Use `@langgenius/dify-ui/popover` or the web `Infotip` wrapper for
  explanatory content, long help text, rich layout, or interactive content.
- Use `@langgenius/dify-ui/tooltip` only for short, non-interactive labels where
  the trigger already has its own accessible name.

## Preferences

- Prefer the most specific semantic primitive over styling a generic `Dialog`.
- Prefer controlled `open` / `onOpenChange` when business state, analytics, or
  cleanup must react to open state changes.
- Prefer the primitive-owned portal or content component. Do not create manual
  portals around overlay primitives.
- Prefer native button trigger semantics. When passing a Base UI trigger
  `render` prop, render a real `<button type="button">` for button-like
  triggers; use `nativeButton={false}` only for intentional non-button triggers.
- Use `Infotip` for visible `?` help triggers. Give icon-only triggers an
  accessible name.
- Keep overlay chrome inside the shared primitive or business wrapper instead of
  repeating backdrop, z-index, and portal styles at call sites.

## Layering

All body-portalled Dify UI overlays use `z-50`. Toast uses `z-60`. The app root
must keep an isolated stacking context.

Do not add call-site z-index overrides such as `z-9999`. If an overlay is
clipped or hidden, fix the parent overlay structure instead of raising the
child primitive.
