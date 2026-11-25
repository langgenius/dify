import type {
  PluginInstallationsResponse,
  PluginParameterOption,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { CollectionPluginsResponse } from '@dify/contracts/marketplace'
import type { FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { mutationOptions, skipToken } from '@tanstack/react-query'
import { toPluginCard } from '@/app/components/plugins/marketplace/plugin-card-adapter'
import { consoleClient, consoleQuery } from '@/service/console'
import { marketplaceQuery } from '@/service/marketplace'
import { normalizeInstalledPluginDetail } from '@/service/use-plugins'

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

type PluginDynamicParameterInput = {
  plugin_id: string
  provider: string
  action: string
  parameter: string
  credential_id?: string | null
  parameter_values?: Record<string, unknown>
}

const dynamicParameterQuery = ({
  credential_id,
  parameter_values,
  ...query
}: PluginDynamicParameterInput) => ({
  ...query,
  ...(credential_id ? { credential_id } : {}),
  ...(parameter_values && Object.keys(parameter_values).length > 0
    ? { parameter_values: JSON.stringify(parameter_values) }
    : {}),
})

export function pluginDynamicOptionsMutationOptions({
  provider_type = 'tool',
  ...input
}: PluginDynamicParameterInput & { provider_type?: 'tool' | 'trigger' }) {
  return mutationOptions({
    mutationFn: () =>
      consoleClient.workspaces.current.plugin.parameters.dynamicOptions
        .get({ query: { ...dynamicParameterQuery(input), provider_type } })
        .then(({ options }) => ({ options: options.map(toDynamicOption) })),
  })
}

const toTreeFormOption = (option: PluginParameterOption): FormOption => ({
  ...toDynamicOption(option),
  children: option.children?.map(toTreeFormOption),
})

export function pluginDynamicTreeOptionsMutationOptions(input: PluginDynamicParameterInput) {
  return mutationOptions({
    mutationFn: () =>
      consoleClient.workspaces.current.plugin.parameters.dynamicTreeOptions
        .get({ query: dynamicParameterQuery(input) })
        .then(({ options }) => ({ options: options.map(toTreeFormOption) })),
  })
}

export function marketplacePluginsByIdsQueryOptions(uniqueIdentifiers: string[]) {
  return marketplaceQuery.pluginsByIdentifiers.queryOptions({
    input: { body: { unique_identifiers: uniqueIdentifiers } },
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
  return marketplaceQuery.pluginsByVersions.queryOptions({
    input: {
      body: {
        plugin_tuples: infos.map((info) => ({
          org: info.organization,
          name: info.plugin,
          version: info.version,
        })),
      },
    },
    enabled: infos.filter((info) => !!info).length > 0,
    retry: 0,
  })
}

// Marketplace plugin ids are `organization/name`, which is the plugin detail route's path.
export function marketplacePluginManifestQueryOptions(pluginUID: string) {
  const separatorIndex = pluginUID.indexOf('/')
  return marketplaceQuery.pluginDetail.queryOptions({
    input: {
      params: {
        organization: separatorIndex === -1 ? pluginUID : pluginUID.slice(0, separatorIndex),
        pluginName: separatorIndex === -1 ? '' : pluginUID.slice(separatorIndex + 1),
      },
    },
    enabled: !!pluginUID,
    retry: 0,
  })
}
