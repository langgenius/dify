import type { Plugin, PluginsFromMarketplaceResponse } from '../../plugins/types'
import type { ActionItem, PluginSearchResult } from './types'
import { renderI18nObject } from '@/i18n-config'
import { postMarketplace } from '@/service/base'
import Icon from '../../plugins/card/base/card-icon'
import { getPluginIconInMarketplace } from '../../plugins/marketplace/utils'

const parser = (plugins: Plugin[], locale: string): PluginSearchResult[] => {
  return plugins.map((plugin) => {
    return {
      id: plugin.name,
      title: renderI18nObject(plugin.label, locale) || plugin.name,
      description: renderI18nObject(plugin.brief, locale) || '',
      type: 'plugin' as const,
      icon: <Icon src={plugin.icon} />,
      data: plugin,
    }
  })
}

export const pluginAction: ActionItem = {
  key: '@plugin',
  shortcut: '@plugin',
  title: 'Search Plugins',
  description: 'Search and navigate to your plugins',
  search: async (_, searchTerm = '', locale) => {
    try {
      const response = await postMarketplace<{ data: PluginsFromMarketplaceResponse }>('/plugins/search/advanced', {
        body: {
          page: 1,
          page_size: 10,
          query: searchTerm,
          type: 'plugin',
        },
      })

      if (!response?.data?.plugins) {
        console.warn('Plugin search: Unexpected response structure', response)
        return []
      }

      const list = response.data.plugins.map(plugin => ({
        ...plugin,
        icon: getPluginIconInMarketplace(plugin),
      }))
      return parser(list, locale!)
    }
    catch (error) {
      console.warn('Plugin search failed:', error)
      return []
    }
  },
}
