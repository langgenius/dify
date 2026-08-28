import { cn } from '@langgenius/dify-ui/cn'
import { MAIN_NAV_APP_CARD_GRID_CLASS_NAME } from '@/app/components/main-nav/app-card-grid'

export const APP_LIST_SEARCH_DEBOUNCE_MS = 500
export const APP_LIST_GRID_PADDING_CLASS_NAME = 'px-8 pt-2'
export const APP_LIST_GRID_COLUMNS_CLASS_NAME = cn('gap-2.5', MAIN_NAV_APP_CARD_GRID_CLASS_NAME)
export const APP_LIST_GRID_CLASS_NAME = cn(
  APP_LIST_GRID_PADDING_CLASS_NAME,
  APP_LIST_GRID_COLUMNS_CLASS_NAME,
)

/** Mirrors the `h-41.5` height AppCard renders at. */
export const APP_CARD_HEIGHT = 166
