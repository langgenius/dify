import type { MarketplacePlugin } from '@dify/contracts/marketplace'
import type { Plugin } from '../types'
import { getMarketplacePluginIconUrl } from '@/features/marketplace/api'

type MarketplacePluginListExtras = {
  agent_strategy?: unknown
  data_sources?: unknown
  model?: unknown
  plugins?: unknown
  privacy_options?: unknown
  privacy_policy?: unknown
  readme_meta?: unknown
  resource?: unknown
  tool?: unknown
  triggers?: unknown
}

export const toListPlugin = (plugin: Plugin): Plugin => {
  const {
    agent_strategy: _agentStrategy,
    data_sources: _dataSources,
    introduction: _introduction,
    model: _model,
    plugins: _plugins,
    privacy_options: _privacyOptions,
    privacy_policy: _privacyPolicy,
    readme_meta: _readmeMeta,
    resource: _resource,
    tool: _tool,
    triggers: _triggers,
    ...listFields
  } = plugin as Plugin & MarketplacePluginListExtras

  return {
    ...listFields,
    introduction: '',
    endpoint: { settings: [] },
  }
}

type MarketplacePluginPayload = MarketplacePlugin | (Plugin & { labels?: Plugin['label'] })

export const getPluginIconInMarketplace = (
  plugin: Pick<MarketplacePluginPayload, 'name' | 'org' | 'type'>,
) => getMarketplacePluginIconUrl(`${plugin.org}/${plugin.name}`, plugin.type)

export const toPluginCard = (payload: MarketplacePluginPayload): Plugin => {
  const plugin = payload as Plugin

  if (payload.type === 'bundle') {
    return {
      ...plugin,
      icon: getPluginIconInMarketplace(payload),
      brief: payload.description as Plugin['brief'],
      label: (payload.labels ?? payload.label) as Plugin['label'],
    }
  }
  return {
    ...plugin,
    icon: getPluginIconInMarketplace(payload),
  }
}
