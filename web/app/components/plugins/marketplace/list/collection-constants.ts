export const GRID_CLASS = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

export const BECOME_PARTNER_URL = 'https://share-na2.hsforms.com/1NiS4r9lsSqGcuNBB77DeEQ40s9fk'

// Collections whose header shows the "Become a Partner" call to action, as
// named by the Marketplace API for the plugin and template catalogs.
export const PARTNER_COLLECTION_NAMES = new Set([
  'partners',
  'partner-template',
  'Partner Template',
])

export const CAROUSEL_PAGE_CLASS = 'w-full shrink-0'

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
