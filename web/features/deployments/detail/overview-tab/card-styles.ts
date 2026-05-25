import { cn } from '@langgenius/dify-ui/cn'

export const OVERVIEW_CARD_CLASS_NAME = 'rounded-xl border border-components-panel-border bg-components-panel-bg p-4'

export const OVERVIEW_INTERACTIVE_CARD_CLASS_NAME = cn(
  OVERVIEW_CARD_CLASS_NAME,
  'transition-colors hover:border-components-panel-border-subtle hover:bg-components-panel-on-panel-item-bg-hover',
)

export const OVERVIEW_ICON_CLASS_NAME = 'flex size-8 shrink-0 items-center justify-center rounded-lg bg-background-section-burn text-text-tertiary'

export const OVERVIEW_STATUS_BADGE_CLASS_NAME = 'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-background-section-burn px-2 system-xs-medium'
