import type { Plugin } from '../../plugins/types'
import type { ActionItem, PluginSearchResult } from './types'
import { renderI18nObject } from '@/i18n/metadata'
import Icon from '../../plugins/card/base/card-icon'

export const parsePluginSearchResults = (
  plugins: Plugin[],
  locale: string,
): PluginSearchResult[] => {
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
