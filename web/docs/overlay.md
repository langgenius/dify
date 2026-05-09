# Overlay Best Practices

Use `@langgenius/dify-ui/*` primitives for overlays in new and modified web
code.

## Import policy

- Use `@langgenius/dify-ui/dialog` for modal content.
- Use `@langgenius/dify-ui/alert-dialog` for confirmation and destructive
  decisions.
- Use `@langgenius/dify-ui/drawer` for side panels, setup panels, and nested
  editor panels.
- Use `@langgenius/dify-ui/popover` or the web `Infotip` wrapper for
  explanatory `?` help content.
- Use `@langgenius/dify-ui/tooltip` only for short, non-interactive labels where
  the trigger already has its own accessible name.

Do not add new imports from legacy overlay paths under
`@/app/components/base/*`.

## Drawer anatomy

Compose drawers from the exported parts:

```tsx
<Drawer open modal swipeDirection="right">
  <DrawerPortal>
    <DrawerBackdrop />
    <DrawerViewport>
      <DrawerPopup>
        <DrawerContent />
      </DrawerPopup>
    </DrawerViewport>
  </DrawerPortal>
</Drawer>
```

For nested drawers that need their own backdrop, put `forceRender` on
`DrawerBackdrop`. `DrawerPopup` does not own this prop. Use
`DrawerPortal keepMounted` only when the portal itself must stay mounted while
closed.

## Layering

All body-portalled Dify UI overlays use `z-50`. Toast uses `z-60`.

Do not add call-site z-index overrides such as `z-9999`. If an overlay is
clipped or hidden, fix the parent overlay structure instead of raising the
child primitive.
