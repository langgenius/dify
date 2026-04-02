export const GRID_CLASS = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

export const GRID_DISPLAY_LIMIT = 4

export const CAROUSEL_PAGE_CLASS = 'w-full shrink-0'

export const CAROUSEL_PAGE_GRID_CLASS = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

export const CAROUSEL_PAGE_SIZE = {
  base: 2,
  sm: 4,
  lg: 6,
  xl: 8,
} as const

export const CAROUSEL_BREAKPOINTS = {
  sm: 640,
  lg: 1024,
  xl: 1280,
} as const

/** Collection name key that triggers carousel display (plugins: partners, templates: featured) */
export const CAROUSEL_COLLECTION_NAMES = {
  partners: 'partners',
  featured: 'featured',
} as const

export type BaseCollection = {
  name: string
  label: Record<string, string>
  description: Record<string, string>
  searchable?: boolean
  search_params?: { query?: string, sort_by?: string, sort_order?: string }
}
