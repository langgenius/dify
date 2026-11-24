import type {
  PluginInstallationsResponse,
  PluginParameterOption,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  CollectionPluginsResponse,
  PluginInfoFromMarketPlace,
  PluginsFromMarketplaceByInfoResponse,
  PluginsFromMarketplaceResponse,
} from '@dify/contracts/marketplace'
import type { FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { mutationOptions, queryOptions, skipToken } from '@tanstack/react-query'
import { toPluginCard } from '@/app/components/plugins/marketplace/plugin-card-adapter'
import { consoleClient, consoleQuery } from '@/service/console'
import { marketplaceQuery } from '@/service/marketplace'
import { normalizeInstalledPluginDetail } from '@/service/use-plugins'
// oxlint-disable-next-line no-restricted-imports -- the marketplace contract has no batch or manifest lookup routes yet
import { getMarketplace, postMarketplace } from './base'

// Module scope keeps each projection stable so selected data is only rebuilt when the cache changes.
const selectInstalledPlugins = (response: PluginInstallationsResponse) => ({
  plugins: response.plugins.map(normalizeInstalledPluginDetail),
})

export function installedPluginsByIdsQueryOptions({
  pluginIds,
  enabled,
}: {
  pluginIds: string[]
  enabled: boolean
}) {
  return consoleQuery.workspaces.current.plugin.list.installations.ids.post.queryOptions({
    input: { body: { plugin_ids: pluginIds } },
    enabled,
    staleTime: 0,
    select: selectInstalledPlugins,
  })
}

const selectCollectionPluginCards = (response: CollectionPluginsResponse) =>
  (response.data?.plugins ?? []).map((plugin) => toPluginCard(plugin))

export function marketplaceCollectionPluginsQueryOptions({
  collection,
  enabled,
  limit = 15,
}: {
  collection: '__recommended-plugins-tools' | '__recommended-plugins-triggers'
  enabled: boolean
  limit?: number
}) {
  return marketplaceQuery.collectionPlugins.queryOptions({
    input: enabled ? { params: { collectionId: collection }, body: { limit } } : skipToken,
    staleTime: 60 * 1000,
    select: selectCollectionPluginCards,
  })
}

// Untranslated labels fall back to en_US, matching renderI18nObject. Dynamic options have no
// display conditions.
const toDynamicOption = ({ value, label, icon }: PluginParameterOption): FormOption => ({
  value,
  label: {
    en_US: label.en_US,
    zh_Hans: label.zh_Hans ?? label.en_US,
    ...(label.ja_JP != null && { ja_JP: label.ja_JP }),
    ...(label.pt_BR != null && { pt_BR: label.pt_BR }),
  },
  icon: icon ?? undefined,
  show_on: [],
})

export function pluginDynamicOptionsMutationOptions(
  plugin_id: string,
  provider: string,
  action: string,
  parameter: string,
  // The backend requires a provider type; callers without one render tool options.
  provider_type: 'tool' | 'trigger' = 'tool',
  extra?: Record<string, unknown>,
) {
  return mutationOptions({
    mutationFn: () =>
      consoleClient.workspaces.current.plugin.parameters.dynamicOptions
        .get({
          query: {
            plugin_id,
            provider,
            action,
            parameter,
            provider_type,
            ...extra,
          },
        })
        .then(({ options }) => ({ options: options.map(toDynamicOption) })),
  })
}

// The marketplace contract has no route for these lookups, so they keep hand-written keys.
const MARKETPLACE_LOOKUP_KEY = 'plugins'

export function marketplacePluginsByIdsQueryOptions(uniqueIdentifiers: string[]) {
  return queryOptions({
    queryKey: [MARKETPLACE_LOOKUP_KEY, 'fetchPluginsInMarketPlaceByIds', uniqueIdentifiers],
    queryFn: () =>
      // oxlint-disable-next-line typescript/no-deprecated -- no marketplace contract for this route
      postMarketplace<{ data: PluginsFromMarketplaceResponse }>('/plugins/identifier/batch', {
        body: { unique_identifiers: uniqueIdentifiers },
      }),
    enabled: uniqueIdentifiers.filter((id) => !!id).length > 0,
    retry: 0,
  })
}

type MarketplacePluginInfoRequest = {
  organization?: string
  plugin?: string
  version?: string
}

export function marketplacePluginsByInfoQueryOptions(infos: MarketplacePluginInfoRequest[]) {
  return queryOptions({
    queryKey: [MARKETPLACE_LOOKUP_KEY, 'fetchPluginsInMarketPlaceByInfo', infos],
    queryFn: () =>
      // oxlint-disable-next-line typescript/no-deprecated -- no marketplace contract for this route
      postMarketplace<{ data: PluginsFromMarketplaceByInfoResponse }>('/plugins/versions/batch', {
        body: {
          plugin_tuples: infos.map((info) => ({
            org: info.organization,
            name: info.plugin,
            version: info.version,
          })),
        },
      }),
    enabled: infos.filter((info) => !!info).length > 0,
    retry: 0,
  })
}

export function marketplacePluginManifestQueryOptions(pluginUID: string) {
  return queryOptions({
    queryKey: [MARKETPLACE_LOOKUP_KEY, 'manifest', pluginUID],
    queryFn: () =>
      // oxlint-disable-next-line typescript/no-deprecated -- no marketplace contract for this route
      getMarketplace<{ data: { plugin: PluginInfoFromMarketPlace; version: { version: string } } }>(
        `/plugins/${pluginUID}`,
      ),
    enabled: !!pluginUID,
    retry: 0,
  })
}
