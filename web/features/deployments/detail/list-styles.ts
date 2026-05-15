import { cn } from '@langgenius/dify-ui/cn'

export const DETAIL_LIST_CLASS_NAME = 'overflow-hidden rounded-lg border border-divider-subtle bg-background-default'
export const DETAIL_LIST_ROW_CLASS_NAME = 'border-b border-divider-subtle last:border-b-0 hover:bg-background-default-hover'
export const DETAIL_LIST_ACTION_TRIGGER_CLASS_NAME = cn(
  'inline-flex size-8 items-center justify-center rounded-md text-text-tertiary outline-hidden',
  'hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
  'data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary',
  'disabled:cursor-not-allowed disabled:opacity-50',
)
