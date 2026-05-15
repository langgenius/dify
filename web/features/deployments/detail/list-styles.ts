import { cn } from '@langgenius/dify-ui/cn'

export const DETAIL_LIST_CLASS_NAME = 'overflow-hidden rounded-lg border border-divider-subtle bg-background-default'
export const DETAIL_LIST_ROW_CLASS_NAME = 'border-b border-divider-subtle last:border-b-0 hover:bg-background-default-hover'
export const DETAIL_LIST_ACTION_TRIGGER_CLASS_NAME = cn(
  'inline-flex size-8 items-center justify-center rounded-md text-text-tertiary outline-hidden',
  'hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
  'data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary',
  'disabled:cursor-not-allowed disabled:opacity-50',
)
export const DETAIL_LIST_HEADER_ROW_CLASS_NAME = 'grid min-h-8 items-center gap-6 border-b border-divider-subtle px-4 py-1.5 system-2xs-medium-uppercase text-text-tertiary'
export const DETAIL_LIST_DESKTOP_ROW_CLASS_NAME = 'grid min-h-12 items-center gap-6 px-4 py-2'
export const DEPLOYMENT_DETAIL_LIST_GRID_CLASS_NAME = 'grid-cols-[minmax(160px,1fr)_minmax(150px,0.75fr)_minmax(180px,1fr)_auto]'
export const RELEASE_DETAIL_LIST_GRID_CLASS_NAME = 'grid-cols-[minmax(150px,1fr)_minmax(130px,0.75fr)_minmax(140px,0.8fr)_minmax(150px,1fr)_auto]'
