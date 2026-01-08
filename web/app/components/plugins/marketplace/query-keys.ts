import type { CollectionsAndPluginsSearchParams, PluginsSearchParams } from './types'

export const marketplaceKeys = {
  all: ['marketplace'] as const,
  collections: (params?: CollectionsAndPluginsSearchParams) => [...marketplaceKeys.all, 'collections', params] as const,
  collectionPlugins: (collectionId: string, params?: CollectionsAndPluginsSearchParams) => [...marketplaceKeys.all, 'collectionPlugins', collectionId, params] as const,
  plugins: (params?: PluginsSearchParams) => [...marketplaceKeys.all, 'plugins', params] as const,
}
