import type { MarketplacePlugin } from '@dify/contracts/marketplace'
import { MARKETPLACE_API_PREFIX } from '@/config'

const apiPrefix = MARKETPLACE_API_PREFIX.replace(/\/$/, '')

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

export const getMarketplaceApiUrl = (path: string) => `${apiPrefix}/${path.replace(/^\//, '')}`

export const getMarketplacePluginIconUrl = (pluginId: string, type?: MarketplacePlugin['type']) =>
  getMarketplaceApiUrl(`${type === 'bundle' ? 'bundles' : 'plugins'}/${encodePath(pluginId)}/icon`)

export const getMarketplaceTemplateIconUrl = (templateId: string) =>
  getMarketplaceApiUrl(`templates/${encodeURIComponent(templateId)}/icon`)

export const resolveMarketplaceAssetUrl = (path?: string) => {
  if (!path) return ''
  if (/^https?:\/\//.test(path) || path.startsWith('/_next/')) return path
  if (path.startsWith('/api/') && URL.canParse(apiPrefix))
    return `${new URL(apiPrefix).origin}${path}`
  return getMarketplaceApiUrl(path)
}
