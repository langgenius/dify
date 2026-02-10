import type { ActivePluginType } from './constants'
import type {
  CollectionsAndPluginsSearchParams,
  Creator,
  CreatorSearchParams,
  PluginCollection,
  PluginsSearchParams,
  Template,
  TemplateCollection,
  TemplateDetail,
  TemplateSearchParams,
  UnifiedCreatorItem,
  UnifiedPluginItem,
  UnifiedSearchParams,
  UnifiedSearchResponse,
  UnifiedTemplateItem,
} from '@/app/components/plugins/marketplace/types'
import type { Plugin } from '@/app/components/plugins/types'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import {
  MARKETPLACE_API_PREFIX,
} from '@/config'
import { marketplaceClient } from '@/service/client'
import { getMarketplaceUrl } from '@/utils/var'
import { PLUGIN_TYPE_SEARCH_MAP } from './constants'

type MarketplaceFetchOptions = {
  signal?: AbortSignal
}

/** Get a string key from an item by field name (e.g. plugin_id, template_id). */
export function getItemKeyByField<T>(item: T, field: keyof T): string {
  return String((item as Record<string, unknown>)[field as string])
}

export const getPluginIconInMarketplace = (plugin: Plugin) => {
  if (plugin.type === 'bundle')
    return `${MARKETPLACE_API_PREFIX}/bundles/${plugin.org}/${plugin.name}/icon`
  return `${MARKETPLACE_API_PREFIX}/plugins/${plugin.org}/${plugin.name}/icon`
}

export const getCreatorAvatarUrl = (uniqueHandle: string) => {
  return `${MARKETPLACE_API_PREFIX}/creators/${uniqueHandle}/avatar`
}

export const getFormattedPlugin = (bundle: Plugin): Plugin => {
  if (bundle.type === 'bundle') {
    return {
      ...bundle,
      icon: getPluginIconInMarketplace(bundle),
      brief: bundle.description,
      // @ts-expect-error I do not have enough information
      label: bundle.labels,
    }
  }
  return {
    ...bundle,
    icon: getPluginIconInMarketplace(bundle),
  }
}

export const getPluginLinkInMarketplace = (plugin: Plugin, params?: Record<string, string | undefined>) => {
  if (plugin.type === 'bundle')
    return getMarketplaceUrl(`/bundles/${plugin.org}/${plugin.name}`, params)
  return getMarketplaceUrl(`/plugins/${plugin.org}/${plugin.name}`, params)
}

export const getPluginDetailLinkInMarketplace = (plugin: Plugin) => {
  if (plugin.type === 'bundle')
    return `/bundles/${plugin.org}/${plugin.name}`
  return `/plugins/${plugin.org}/${plugin.name}`
}

export const getMarketplacePluginsByCollectionId = async (
  collectionId: string,
  query?: CollectionsAndPluginsSearchParams,
  options?: MarketplaceFetchOptions,
) => {
  let plugins: Plugin[] = []

  try {
    const marketplaceCollectionPluginsDataJson = await marketplaceClient.plugins.collectionPlugins({
      params: {
        collectionId,
      },
      body: query,
    }, {
      signal: options?.signal,
    })
    plugins = (marketplaceCollectionPluginsDataJson.data?.plugins || []).map(plugin => getFormattedPlugin(plugin))
  }
  // eslint-disable-next-line unused-imports/no-unused-vars
  catch (e) {
    plugins = []
  }

  return plugins
}

export const getMarketplaceCollectionsAndPlugins = async (
  query?: CollectionsAndPluginsSearchParams,
  options?: MarketplaceFetchOptions,
) => {
  let pluginCollections: PluginCollection[] = []
  let pluginCollectionPluginsMap: Record<string, Plugin[]> = {}
  try {
    const collectionsDataJson = await marketplaceClient.plugins.collections({
      query: {
        ...query,
        page: 1,
        page_size: 100,
      },
    }, {
      signal: options?.signal,
    })
    pluginCollections = collectionsDataJson.data?.collections || []
    await Promise.all(pluginCollections.map(async (collection: PluginCollection) => {
      const plugins = await getMarketplacePluginsByCollectionId(collection.name, query, options)

      pluginCollectionPluginsMap[collection.name] = plugins
    }))
  }
  // eslint-disable-next-line unused-imports/no-unused-vars
  catch (e) {
    pluginCollections = []
    pluginCollectionPluginsMap = {}
  }

  return {
    marketplaceCollections: pluginCollections,
    marketplaceCollectionPluginsMap: pluginCollectionPluginsMap,
  }
}

export function mapTemplateDetailToTemplate(template: TemplateDetail): Template {
  const descriptionText = template.overview || template.readme || ''
  return {
    template_id: template.id,
    name: template.template_name,
    description: {
      en_US: descriptionText,
      zh_Hans: descriptionText,
    },
    icon: template.icon || '',
    tags: template.categories || [],
    author: template.publisher_unique_handle || template.creator_email || '',
    created_at: template.created_at,
    updated_at: template.updated_at,
  }
}

export const getMarketplaceTemplateCollectionsAndTemplates = async (
  query?: { page?: number, page_size?: number, condition?: string },
  options?: MarketplaceFetchOptions,
) => {
  let templateCollections: TemplateCollection[] = []
  let templateCollectionTemplatesMap: Record<string, Template[]> = {}

  try {
    const res = await marketplaceClient.templateCollections.list({
      query: {
        ...query,
        page: 1,
        page_size: 100,
      },
    }, {
      signal: options?.signal,
    })
    templateCollections = res.data?.collections || []

    await Promise.all(templateCollections.map(async (collection) => {
      try {
        const templatesRes = await marketplaceClient.templateCollections.getTemplates({
          params: { collectionName: collection.name },
          body: { limit: 20 },
        }, { signal: options?.signal })
        const templatesData = templatesRes.data?.templates || []
        templateCollectionTemplatesMap[collection.name] = templatesData.map(mapTemplateDetailToTemplate)
      }
      catch {
        templateCollectionTemplatesMap[collection.name] = []
      }
    }))
  }
  catch {
    templateCollections = []
    templateCollectionTemplatesMap = {}
  }

  return {
    templateCollections,
    templateCollectionTemplatesMap,
  }
}

export const getMarketplacePlugins = async (
  queryParams: PluginsSearchParams | undefined,
  pageParam: number,
  signal?: AbortSignal,
) => {
  if (!queryParams) {
    return {
      plugins: [] as Plugin[],
      total: 0,
      page: 1,
      page_size: 40,
    }
  }

  const {
    query,
    sort_by,
    sort_order,
    category,
    tags,
    type,
    page_size = 40,
  } = queryParams

  try {
    const res = await marketplaceClient.plugins.searchAdvanced({
      params: {
        kind: type === 'bundle' ? 'bundles' : 'plugins',
      },
      body: {
        page: pageParam,
        page_size,
        query,
        sort_by,
        sort_order,
        category: category !== 'all' ? category : '',
        tags,
      },
    }, { signal })
    const resPlugins = res.data.bundles || res.data.plugins || []

    return {
      plugins: resPlugins.map(plugin => getFormattedPlugin(plugin)),
      total: res.data.total,
      page: pageParam,
      page_size,
    }
  }
  catch {
    return {
      plugins: [],
      total: 0,
      page: pageParam,
      page_size,
    }
  }
}

export const getPluginCondition = (pluginType: string) => {
  if ([PluginCategoryEnum.tool, PluginCategoryEnum.agent, PluginCategoryEnum.model, PluginCategoryEnum.datasource, PluginCategoryEnum.trigger].includes(pluginType as PluginCategoryEnum))
    return `category=${pluginType}`

  if (pluginType === PluginCategoryEnum.extension)
    return 'category=endpoint'

  if (pluginType === 'bundle')
    return 'type=bundle'

  return ''
}

export const getPluginFilterType = (category: ActivePluginType) => {
  if (category === PLUGIN_TYPE_SEARCH_MAP.all)
    return undefined

  if (category === PLUGIN_TYPE_SEARCH_MAP.bundle)
    return 'bundle'

  return 'plugin'
}

export function getCollectionsParams(category: ActivePluginType): CollectionsAndPluginsSearchParams {
  if (category === PLUGIN_TYPE_SEARCH_MAP.all) {
    return {}
  }
  return {
    category,
    condition: getPluginCondition(category),
    type: getPluginFilterType(category),
  }
}

export const getMarketplaceTemplates = async (
  queryParams: TemplateSearchParams | undefined,
  pageParam: number,
  signal?: AbortSignal,
): Promise<{
  templates: TemplateDetail[]
  total: number
  page: number
  page_size: number
}> => {
  if (!queryParams) {
    return {
      templates: [] as TemplateDetail[],
      total: 0,
      page: 1,
      page_size: 40,
    }
  }

  const {
    query,
    sort_by,
    sort_order,
    categories,
    languages,
    page_size = 40,
  } = queryParams

  try {
    const res = await marketplaceClient.templates.searchAdvanced({
      body: {
        page: pageParam,
        page_size,
        query,
        sort_by,
        sort_order,
        categories,
        languages,
      },
    }, { signal })

    return {
      templates: res.data?.templates || [],
      total: res.data?.total || 0,
      page: pageParam,
      page_size,
    }
  }
  catch {
    return {
      templates: [],
      total: 0,
      page: pageParam,
      page_size,
    }
  }
}

export const getMarketplaceCreators = async (
  queryParams: CreatorSearchParams | undefined,
  pageParam: number,
  signal?: AbortSignal,
): Promise<{
  creators: Creator[]
  total: number
  page: number
  page_size: number
}> => {
  if (!queryParams) {
    return {
      creators: [],
      total: 0,
      page: 1,
      page_size: 40,
    }
  }

  const {
    query,
    sort_by,
    sort_order,
    categories,
    page_size = 40,
  } = queryParams

  try {
    const res = await marketplaceClient.creators.searchAdvanced({
      body: {
        page: pageParam,
        page_size,
        query,
        sort_by,
        sort_order,
        categories,
      },
    }, { signal })

    const creators = (res.data?.creators || []).map((c: Creator) => ({
      ...c,
      display_name: c.display_name || c.name,
      display_email: c.display_email ?? '',
      social_links: c.social_links ?? [],
    }))

    return {
      creators,
      total: res.data?.total || 0,
      page: pageParam,
      page_size,
    }
  }
  catch {
    return {
      creators: [],
      total: 0,
      page: pageParam,
      page_size,
    }
  }
}

/**
 * Map unified search plugin item to Plugin type
 */
export function mapUnifiedPluginToPlugin(item: UnifiedPluginItem): Plugin {
  return {
    type: item.type,
    org: item.org,
    name: item.name,
    plugin_id: item.plugin_id,
    version: item.latest_version,
    latest_version: item.latest_version,
    latest_package_identifier: item.latest_package_identifier,
    icon: `${MARKETPLACE_API_PREFIX}/plugins/${item.org}/${item.name}/icon`,
    verified: item.verification?.authorized_category === 'langgenius',
    label: item.label,
    brief: item.brief,
    description: item.brief,
    introduction: '',
    repository: item.repository || '',
    category: item.category as PluginCategoryEnum,
    install_count: item.install_count,
    endpoint: { settings: [] },
    tags: item.tags || [],
    badges: item.badges || [],
    verification: item.verification,
    from: 'marketplace',
  }
}

/**
 * Map unified search template item to Template type
 */
export function mapUnifiedTemplateToTemplate(item: UnifiedTemplateItem): Template {
  const descriptionText = item.overview || item.readme || ''
  return {
    template_id: item.id,
    name: item.template_name,
    description: {
      en_US: descriptionText,
      zh_Hans: descriptionText,
    },
    icon: item.icon || '',
    tags: item.categories || [],
    author: item.publisher_handle || '',
    created_at: item.created_at,
    updated_at: item.updated_at,
  }
}

/**
 * Map unified search creator item to Creator type
 */
export function mapUnifiedCreatorToCreator(item: UnifiedCreatorItem): Creator {
  return {
    email: item.email || '',
    name: item.name || '',
    display_name: item.display_name || item.name || '',
    unique_handle: item.unique_handle || '',
    display_email: '',
    description: item.description || '',
    avatar: item.avatar || '',
    social_links: [],
    status: item.status || 'active',
    plugin_count: item.plugin_count,
    template_count: item.template_count,
    created_at: '',
    updated_at: '',
  }
}

/**
 * Fetch unified search results
 */
export const getMarketplaceUnifiedSearch = async (
  queryParams: UnifiedSearchParams | undefined,
  signal?: AbortSignal,
): Promise<UnifiedSearchResponse['data'] & { page: number, page_size: number }> => {
  if (!queryParams || !queryParams.query.trim()) {
    return {
      creators: { items: [], total: 0 },
      organizations: { items: [], total: 0 },
      plugins: { items: [], total: 0 },
      templates: { items: [], total: 0 },
      page: 1,
      page_size: queryParams?.page_size || 10,
    }
  }

  const {
    query,
    scope,
    page = 1,
    page_size = 10,
  } = queryParams

  try {
    const res = await marketplaceClient.searchUnified({
      body: {
        query,
        scope,
        page,
        page_size,
      },
    }, { signal })

    return {
      creators: res.data?.creators || { items: [], total: 0 },
      organizations: res.data?.organizations || { items: [], total: 0 },
      plugins: res.data?.plugins || { items: [], total: 0 },
      templates: res.data?.templates || { items: [], total: 0 },
      page,
      page_size,
    }
  }
  catch {
    return {
      creators: { items: [], total: 0 },
      organizations: { items: [], total: 0 },
      plugins: { items: [], total: 0 },
      templates: { items: [], total: 0 },
      page,
      page_size,
    }
  }
}
