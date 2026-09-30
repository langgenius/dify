import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import type { TemplateCategory } from './categories'
import { validate as isUuid } from 'uuid'
import { isTemplateCategory } from './categories'

export const PAGE_LINK_CLASS =
  'flex h-8 items-center justify-center rounded-lg border-[0.5px] border-divider-regular px-3 system-sm-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'
export const PAGE_LINK_DISABLED_CLASS =
  'flex h-8 cursor-not-allowed items-center justify-center rounded-lg border-[0.5px] border-divider-subtle px-3 system-sm-medium text-text-quaternary'

export type TemplateDetailSelection = {
  id: string
  publisher: string
}

export function buildTemplateDetailHref(
  template: Pick<MarketplaceTemplate, 'id' | 'publisher_handle' | 'publisher_unique_handle'>,
) {
  const publisher = template.publisher_unique_handle || template.publisher_handle || 'template'
  return `/templates/${encodeURIComponent(publisher)}/${encodeURIComponent(template.id)}`
}

export function parseTemplateDetailPath(pathname: string): TemplateDetailSelection | undefined {
  const match = pathname.match(/^\/templates\/([^/]+)\/([^/]+)\/?$/)
  const publisherSegment = match?.[1]
  const idSegment = match?.[2]
  if (!publisherSegment || !idSegment) return undefined

  const publisher = decodeURIComponent(publisherSegment)
  const id = decodeURIComponent(idSegment)
  return isUuid(id) ? { publisher, id } : undefined
}

export function parseTemplatesRoute(segments?: string[]): {
  category: TemplateCategory
  selection?: TemplateDetailSelection
} {
  const publisher = segments?.[0]
  const id = segments?.[1]
  if (segments?.length === 2 && publisher && id && isUuid(id)) {
    return {
      category: 'all',
      selection: { publisher, id },
    }
  }

  const requested = segments?.[0]
  return {
    category: isTemplateCategory(requested) ? requested : 'all',
  }
}

export type TemplatesHrefOptions = {
  category: TemplateCategory
  languages?: string[]
  page?: number
  query?: string
  sortBy?: string
  sortOrder?: string
  view?: string
}

export function buildTemplatesHref({
  category,
  languages,
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
  if (languages?.length) searchParams.set('languages', languages.join(','))
  if (page > 1) searchParams.set('page', String(page))
  const queryString = searchParams.toString()
  const basePath = category === 'all' ? '/templates' : `/templates/${category}`
  return queryString ? `${basePath}?${queryString}` : basePath
}
