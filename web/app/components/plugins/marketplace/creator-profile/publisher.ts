import type { MarketplacePlugin, MarketplaceTemplate } from '@dify/contracts/marketplace'
import type { CreatorCreation, CreatorSortField, CreatorSortOrder } from './model'
import type { Plugin } from '@/app/components/plugins/types'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { marketplaceClient } from '@/service/client'
import { getFormattedPlugin, getPluginIconInMarketplace } from '../utils'
import { adaptCreations, toPublisherSortQuery } from './model'

export const CREATOR_PAGE_SIZE = 40

export type PublisherPage<T> = {
  items: T[]
  total?: number
  hasMore: boolean
}

export const publisherPageHasMore = (page: number, itemCount: number, total?: number) =>
  typeof total === 'number' ? page * CREATOR_PAGE_SIZE < total : itemCount === CREATOR_PAGE_SIZE

export const getTemplateIcon = (template: MarketplaceTemplate) =>
  template.icon_file_key
    ? `${MARKETPLACE_API_PREFIX}/templates/${encodeURIComponent(template.id)}/icon`
    : ''

export const getDependencyIcon = (pluginId: string) => {
  if (!pluginId.includes('/')) return ''
  return `${MARKETPLACE_API_PREFIX}/plugins/${pluginId.split('/').map(encodeURIComponent).join('/')}/icon`
}

export async function fetchPublisherPluginPage({
  uniqueHandle,
  page,
  sortField,
  sortOrder,
}: {
  uniqueHandle: string
  page: number
  sortField: CreatorSortField
  sortOrder: CreatorSortOrder
}): Promise<PublisherPage<MarketplacePlugin>> {
  const { plugins } = toPublisherSortQuery(sortField, sortOrder)
  const response = await marketplaceClient.publisherPlugins({
    params: { uniqueHandle },
    query: { page, page_size: CREATOR_PAGE_SIZE, ...plugins },
  })
  const items = response.data?.plugins ?? []
  const total = response.data?.total
  return { items, total, hasMore: publisherPageHasMore(page, items.length, total) }
}

export async function fetchPublisherTemplatePage({
  uniqueHandle,
  page,
  sortField,
  sortOrder,
}: {
  uniqueHandle: string
  page: number
  sortField: CreatorSortField
  sortOrder: CreatorSortOrder
}): Promise<PublisherPage<MarketplaceTemplate>> {
  const { templates } = toPublisherSortQuery(sortField, sortOrder)
  const response = await marketplaceClient.publisherTemplates({
    params: { uniqueHandle },
    query: { page, page_size: CREATOR_PAGE_SIZE, ...templates },
  })
  const items = response.data?.templates ?? []
  const total = response.data?.total
  return { items, total, hasMore: publisherPageHasMore(page, items.length, total) }
}

export const toCreatorRecords = ({
  locale,
  plugins,
  templates,
}: {
  locale: string
  plugins: MarketplacePlugin[]
  templates: MarketplaceTemplate[]
}): {
  creations: CreatorCreation[]
  pluginsByCreationId: Record<string, Plugin>
  templatesByCreationId: Record<string, MarketplaceTemplate>
} => ({
  creations: adaptCreations({
    locale,
    plugins,
    templates,
    resolvePluginIcon: getPluginIconInMarketplace,
    resolveTemplateIcon: getTemplateIcon,
    resolveDependencyIcon: getDependencyIcon,
  }),
  pluginsByCreationId: Object.fromEntries(
    plugins.map((plugin) => [
      `${plugin.type}:${plugin.org}/${plugin.name}`,
      getFormattedPlugin(plugin),
    ]),
  ),
  templatesByCreationId: Object.fromEntries(
    templates.map((template) => [`template:${template.id}`, template]),
  ),
})
