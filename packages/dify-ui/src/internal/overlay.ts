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
  'z-50 outline-hidden data-anchor-hidden:invisible data-anchor-hidden:pointer-events-none'
export const hintPopupClassName =
  'max-w-75 rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-1.5 text-start system-xs-medium wrap-break-word text-text-secondary shadow-[0px_12px_16px_-4px_var(--color-shadow-shadow-5),0px_4px_6px_-2px_var(--color-shadow-shadow-1)] backdrop-blur-[5px] origin-(--transform-origin) transition-opacity data-ending-style:opacity-0 data-instant:transition-none data-starting-style:opacity-0 motion-reduce:transition-none'
export const modalBackdropClassName =
  'absolute inset-0 z-50 bg-background-overlay transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none'
export const modalPopupAnimationClassName =
  'transition-[transform,scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none'
