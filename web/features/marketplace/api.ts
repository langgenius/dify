import type { MarketplacePlugin } from '@dify/contracts/marketplace'
import { env } from '@/env'

const isLocalMarketplaceApiUrl = (url: string | undefined) =>
  /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(url ?? '')

// Docker entrypoint sets NEXT_PUBLIC_MARKETPLACE_API_PREFIX=${MARKETPLACE_API_URL}/api/v1.
// MARKETPLACE_API_URL itself is the site origin (no /api/v1). Standalone marketplace
// images may set MARKETPLACE_API_URL at runtime for SSR; normalize the same way
// entrypoint does so console SSR does not call the HTML origin and fail Templates.
const marketplaceApiPrefixFromUrl = (url: string) => {
  const trimmed = url.replace(/\/$/, '')
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`
}

const runtimeMarketplaceApiUrl =
  typeof globalThis.window === 'undefined' &&
  process.env.MARKETPLACE_API_URL &&
  !isLocalMarketplaceApiUrl(process.env.MARKETPLACE_API_URL)
    ? marketplaceApiPrefixFromUrl(process.env.MARKETPLACE_API_URL)
    : undefined

export const MARKETPLACE_API_PREFIX =
  runtimeMarketplaceApiUrl || env.NEXT_PUBLIC_MARKETPLACE_API_PREFIX || 'http://localhost:5002/api'

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
  if (!path.startsWith('/api/')) return getMarketplaceApiUrl(path)

  try {
    return `${new URL(apiPrefix).origin}${path}`
  } catch {
    return path
  }
}
