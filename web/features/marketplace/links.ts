import type { MarketplacePlugin, MarketplaceTemplate } from '@dify/contracts/marketplace'
import { env } from '@/env'

type MarketplaceUrlParams = Record<string, string | undefined>

export type MarketplacePluginRef = Pick<MarketplacePlugin, 'org' | 'name'> & {
  type?: MarketplacePlugin['type']
}

type MarketplaceTemplateRef = Pick<
  MarketplaceTemplate,
  'id' | 'publisher_handle' | 'publisher_unique_handle'
>

export const PUBLIC_CREATOR_CENTER_URL = 'https://creators.dify.ai/'

const getUrlOrigin = (url?: string) => {
  if (!url) return undefined

  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

const defaultSource = getUrlOrigin(env.NEXT_PUBLIC_WEB_PREFIX)

const OFFICIAL_MARKETPLACE_URL = 'https://marketplace.dify.ai'

const buildUrl = (origin: string, path: string, params?: MarketplaceUrlParams, source?: string) => {
  const searchParams = new URLSearchParams()
  const sourceOrigin = getUrlOrigin(source) ?? defaultSource
  if (sourceOrigin) searchParams.set('source', sourceOrigin)

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined) searchParams.set(key, value)
  })

  const queryString = searchParams.toString()
  return queryString ? `${origin}${path}?${queryString}` : `${origin}${path}`
}

const page = (path: string, params?: MarketplaceUrlParams, source?: string) =>
  buildUrl(env.NEXT_PUBLIC_MARKETPLACE_URL_PREFIX ?? '', path, params, source)

export const getPluginDetailPath = (plugin: MarketplacePluginRef) => {
  const org = encodeURIComponent(plugin.org)
  const name = encodeURIComponent(plugin.name)

  if (plugin.type === 'bundle') return `/bundles/${org}/${name}`
  return `/plugin/${org}/${name}`
}

export const getTemplateDetailPath = (template: MarketplaceTemplateRef) => {
  const publisher = template.publisher_unique_handle || template.publisher_handle || 'template'

  return `/template/${encodeURIComponent(publisher)}/${encodeURIComponent(template.id)}`
}

/**
 * marketplace.dify.ai → creators.dify.ai
 * marketplace.dify.dev → creators.dify.dev
 * marketplace-staging.dify.dev → creators-staging.dify.dev
 */
export const rewriteMarketplaceOriginToCreators = (origin: string): string | null => {
  if (!origin) return null

  try {
    const marketplaceUrl = new URL(origin)
    const [service, ...domain] = marketplaceUrl.hostname.split('.')
    if (!service?.startsWith('marketplace') || domain.length === 0) return null

    marketplaceUrl.hostname = [service.replace(/^marketplace/, 'creators'), ...domain].join('.')
    marketplaceUrl.pathname = '/'
    marketplaceUrl.search = ''
    marketplaceUrl.hash = ''
    return marketplaceUrl.toString()
  } catch {
    return null
  }
}

export const getCreatorCenterUrl = (pageOrigin?: string): string => {
  return (
    rewriteMarketplaceOriginToCreators(pageOrigin ?? '') ||
    rewriteMarketplaceOriginToCreators(env.NEXT_PUBLIC_MARKETPLACE_URL_PREFIX ?? '') ||
    PUBLIC_CREATOR_CENTER_URL
  )
}

/**
 * Links to Marketplace pages. Console surfaces get them from `useMarketplace()`,
 * which returns `null` when the deployment disables Marketplace.
 */
export const marketplaceLinks = {
  page,
  plugin: (plugin: MarketplacePluginRef, params?: MarketplaceUrlParams) =>
    page(
      `/${plugin.type === 'bundle' ? 'bundles' : 'plugins'}/${plugin.org}/${plugin.name}`,
      params,
    ),
  category: (category?: string, params?: MarketplaceUrlParams) =>
    page(category ? `/plugins/${category}` : '/plugins', params),
  template: (template: MarketplaceTemplateRef, params?: MarketplaceUrlParams) => {
    const {
      tid: _tid,
      templateId: _templateId,
      creationType: _creationType,
      ...detailParams
    } = params ?? {}

    return page(getTemplateDetailPath(template), detailParams)
  },
  officialPluginDetail: (
    plugin: MarketplacePluginRef,
    params: MarketplaceUrlParams,
    source: string,
  ) => buildUrl(OFFICIAL_MARKETPLACE_URL, getPluginDetailPath(plugin), params, source),
  officialTemplateDetail: (
    template: MarketplaceTemplateRef,
    params: MarketplaceUrlParams,
    source: string,
  ) => buildUrl(OFFICIAL_MARKETPLACE_URL, getTemplateDetailPath(template), params, source),
  creatorCenter: getCreatorCenterUrl(),
}

export type MarketplaceLinks = typeof marketplaceLinks
