import type { Plugin } from './types'
import { API_PREFIX } from '@/config'
import { getMarketplacePluginIconUrl } from '@/features/marketplace/api'

const hasUrlProtocol = (value: string) => /^[a-z][a-z\d+.-]*:/i.test(value)

export const getPluginCardIconUrl = (
  plugin: Pick<Plugin, 'from' | 'name' | 'org' | 'type'>,
  icon: string | { content: string; background: string } | undefined,
  tenantId: string,
) => {
  if (!icon) return ''

  if (typeof icon === 'object') return icon

  if (hasUrlProtocol(icon) || icon.startsWith('/')) return icon

  if (plugin.from === 'marketplace')
    return getMarketplacePluginIconUrl(`${plugin.org}/${plugin.name}`, plugin.type)

  if (!tenantId) return icon

  return `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${tenantId}&filename=${icon}`
}
