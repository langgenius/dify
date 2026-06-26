import { cn } from '@langgenius/dify-ui/cn'

export const DETAIL_TABLE_ACTION_TRIGGER_CLASS_NAME = cn(
  'inline-flex size-8 items-center justify-center rounded-md text-text-tertiary outline-hidden',
  'hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
  'data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary',
  'disabled:cursor-not-allowed disabled:opacity-50',
)
