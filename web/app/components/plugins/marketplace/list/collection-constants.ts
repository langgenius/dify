export const GRID_CLASS = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

export const GRID_DISPLAY_LIMIT = 8

export const CAROUSEL_COLUMN_CLASS = 'flex w-[calc((100%-0px)/1)] shrink-0 flex-col gap-3 sm:w-[calc((100%-12px)/2)] lg:w-[calc((100%-24px)/3)] xl:w-[calc((100%-36px)/4)]'

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
