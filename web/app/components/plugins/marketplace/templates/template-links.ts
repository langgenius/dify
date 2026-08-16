import type { TemplateCategory } from './categories'

export const PAGE_LINK_CLASS =
  'flex h-8 items-center justify-center rounded-lg border-[0.5px] border-divider-regular px-3 system-sm-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'
export const PAGE_LINK_DISABLED_CLASS =
  'flex h-8 cursor-not-allowed items-center justify-center rounded-lg border-[0.5px] border-divider-subtle px-3 system-sm-medium text-text-quaternary'

export type TemplatesHrefOptions = {
  category: TemplateCategory
  page?: number
  query?: string
  sortBy?: string
  sortOrder?: string
  view?: string
}

export function buildTemplatesHref({
  category,
  page = 1,
  query,
  sortBy,
  sortOrder,
  view,
}: TemplatesHrefOptions) {
  const searchParams = new URLSearchParams()
  if (query) searchParams.set('q', query)
  if (sortBy) searchParams.set('sort_by', sortBy)
  if (sortOrder) searchParams.set('sort_order', sortOrder)
  if (view) searchParams.set('view', view)
  if (page > 1) searchParams.set('page', String(page))
  const queryString = searchParams.toString()
  const basePath = category === 'all' ? '/templates' : `/templates/${category}`
  return queryString ? `${basePath}?${queryString}` : basePath
}
