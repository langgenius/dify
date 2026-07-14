import type { Plugin } from '../../plugins/types'
import type { ActionItem, PluginSearchResult } from './types'
import { renderI18nObject } from '@/i18n-config'
import { marketplaceQuery } from '@/service/client'
import Icon from '../../plugins/card/base/card-icon'
import { getFormattedPlugin } from '../../plugins/marketplace/utils'

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
  source: 'remote',
}

export function pluginSearchQueryOptions(searchTerm: string, locale: string) {
  return marketplaceQuery.searchAdvanced.queryOptions({
    input: {
      params: { kind: 'plugins' },
      body: {
        page: 1,
        page_size: 10,
        query: searchTerm,
      },
    },
    select: (response) => {
      const plugins = response.data?.plugins ?? []
      return parser(
        plugins.map((plugin) => getFormattedPlugin(plugin)),
        locale,
      )
    },
  })
}
