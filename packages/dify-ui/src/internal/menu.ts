export type MenuItemVariant = 'default' | 'destructive'

export const menuItemClassName =
  'mx-1 flex h-8 select-none items-center gap-1 rounded-lg px-2 outline-hidden data-highlighted:bg-state-base-hover data-disabled:cursor-not-allowed data-disabled:opacity-30'

export const menuItemDestructiveClassName =
  'data-[variant=destructive]:text-text-destructive data-[variant=destructive]:data-highlighted:bg-state-destructive-hover'

export const menuPopupBaseClassName =
  'max-h-(--available-height) overflow-y-auto overflow-x-hidden text-sm text-text-secondary outline-hidden focus:outline-hidden focus-visible:outline-hidden'

// The popup scrolls through `menuPopupBaseClassName`, so its vertical padding scrolls away with the
// items. The scroll padding repeats that padding; change both together.
export const menuPopupSurfaceClassName =
  'rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur py-1 scroll-py-1 shadow-lg backdrop-blur-[5px]'
