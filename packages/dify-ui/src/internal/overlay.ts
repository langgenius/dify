export const floatingItemIndicatorClassName = 'ms-auto flex shrink-0 items-center text-text-accent'
// The horizontal inset belongs to the component: it depends on whether the label sits in the
// popup (12px) or in a padded list (8px, with the list's padding supplying the rest).
export const floatingGroupLabelClassName =
  'pb-0.5 pt-1 text-text-tertiary system-xs-medium-uppercase'
export const floatingSeparatorClassName = 'my-1 h-px bg-divider-subtle'

export const floatingPopupAnimationClassName =
  'origin-(--transform-origin) transition-[transform,scale,opacity] data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:transition-none motion-reduce:transition-none'
// Positioners hide with their anchor: Base UI only emits `data-anchor-hidden` when the anchor is
// clipped, display:none or unmounted, and would otherwise keep the popup at the viewport origin.
export const positionerClassName =
  'outline-hidden data-anchor-hidden:invisible data-anchor-hidden:pointer-events-none'
export const hintPopupClassName =
  'max-w-75 rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-1.5 text-start system-xs-medium wrap-break-word text-text-secondary shadow-[0px_12px_16px_-4px_var(--color-shadow-shadow-5),0px_4px_6px_-2px_var(--color-shadow-shadow-1)] backdrop-blur-[5px] origin-(--transform-origin) transition-opacity data-ending-style:opacity-0 data-instant:transition-none data-starting-style:opacity-0 motion-reduce:transition-none'
export const modalBackdropClassName =
  'absolute inset-0 bg-background-overlay transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none'
export const modalSurfaceClassName =
  'rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl'
export const modalTitleClassName = 'title-2xl-semi-bold wrap-break-word text-text-primary'
// A parent surface steps back while a dialog opens on top of it; Base UI sets `--nested-dialogs`.
export const modalStackClassName =
  'scale-[calc(1-0.05*var(--nested-dialogs,0))] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-text-primary/5 after:opacity-0 after:transition-opacity after:duration-150 data-nested-dialog-open:after:opacity-100'
export const modalPopupAnimationClassName =
  'transition-[transform,scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none'
