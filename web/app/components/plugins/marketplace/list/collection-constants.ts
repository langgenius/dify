export const GRID_CLASS = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

export const CAROUSEL_PAGE_CLASS = 'min-w-0 shrink-0 grow-0 basis-full'

export const CAROUSEL_PAGE_GRID_CLASS = GRID_CLASS

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
