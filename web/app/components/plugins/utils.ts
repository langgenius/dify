import type {
  TagKey,
} from './constants'
import type { Plugin } from './types'

import { API_PREFIX, MARKETPLACE_API_PREFIX } from '@/config'
import {
  categoryKeys,
  tagKeys,
} from './constants'

export const getValidTagKeys = (tags: TagKey[]) => {
  return tags.filter(tag => tagKeys.includes(tag))
}

export const getValidCategoryKeys = (category?: string) => {
  return categoryKeys.find(key => key === category)
}

const hasUrlProtocol = (value: string) => /^[a-z][a-z\d+.-]*:/i.test(value)

export const getPluginCardIconUrl = (
  plugin: Pick<Plugin, 'from' | 'name' | 'org' | 'type'>,
  icon: string | { content: string, background: string } | undefined,
  tenantId: string,
) => {
  if (!icon)
    return ''

  if (typeof icon === 'object')
    return icon

  if (hasUrlProtocol(icon) || icon.startsWith('/'))
    return icon

  if (plugin.from === 'marketplace') {
    const basePath = plugin.type === 'bundle' ? 'bundles' : 'plugins'
    return `${MARKETPLACE_API_PREFIX}/${basePath}/${plugin.org}/${plugin.name}/icon`
  }

  if (!tenantId)
    return icon

  return `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${tenantId}&filename=${icon}`
}
