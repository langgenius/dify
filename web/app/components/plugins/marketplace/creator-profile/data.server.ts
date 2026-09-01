import type {
  MarketplaceCreator,
  MarketplaceOrganization,
  MarketplacePlugin,
  MarketplaceTemplate,
} from '@dify/contracts/marketplace'
import type { CreatorSortField, CreatorSortOrder, LoadedCreatorProfile } from './model'
import { cache } from 'react'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { marketplaceClient } from '@/service/client'
import { getFormattedPlugin, getPluginIconInMarketplace } from '../utils'
import {
  adaptCreatorProfile,
  parseCreatorSortField,
  parseCreatorSortOrder,
  sortCreatorCreations,
  toPublisherSortQuery,
} from './model'
import 'server-only'

const PAGE_SIZE = 40
const MAX_PAGES = 5

const fetchAllPublisherPages = async <T>(
  fetchPage: (page: number) => Promise<{ items: T[]; total?: number }>,
) => {
  const first = await fetchPage(1)
  const items = [...first.items]
  const total = first.total ?? items.length

  for (let page = 2; page <= MAX_PAGES && items.length < total; page++) {
    const next = await fetchPage(page)
    if (next.items.length === 0) break
    items.push(...next.items)
  }

  return items
}

const mapOrganizationToCreator = (
  organization: MarketplaceOrganization,
  uniqueHandle: string,
): MarketplaceCreator => ({
  id: organization.id || organization.name,
  email: organization.email,
  name: organization.name || organization.display_name || uniqueHandle,
  display_name: organization.display_name || organization.name || uniqueHandle,
  unique_handle: organization.unique_handle || uniqueHandle,
  display_email: organization.display_email,
  description: organization.description,
  avatar: organization.avatar,
  background_image: organization.background_image,
  social_links: organization.social_links ?? [],
  badges: organization.badges,
  verified: organization.verified,
  status: organization.status,
  created_at: organization.created_at,
  updated_at: organization.updated_at,
})

const getPublisher = async (uniqueHandle: string, publisherType?: string) => {
  if (publisherType === 'organization') {
    const response = await marketplaceClient.organizationDetail({
      params: { id: uniqueHandle },
    })
    const organization = response.data?.organization
    return organization ? mapOrganizationToCreator(organization, uniqueHandle) : undefined
  }

  const response = await marketplaceClient.creatorDetail({
    params: { uniqueHandle },
  })
  return response.data?.creator
}

const getPublisherPlugins = async (
  uniqueHandle: string,
  sortField: CreatorSortField,
  sortOrder: CreatorSortOrder,
) => {
  const { plugins } = toPublisherSortQuery(sortField, sortOrder)
  return fetchAllPublisherPages(async (page) => {
    const response = await marketplaceClient.publisherPlugins({
      params: { uniqueHandle },
      query: { page, page_size: PAGE_SIZE, ...plugins },
    })
    return {
      items: response.data?.plugins ?? [],
      total: response.data?.total,
    }
  })
}

const getPublisherTemplates = async (
  uniqueHandle: string,
  sortField: CreatorSortField,
  sortOrder: CreatorSortOrder,
) => {
  const { templates } = toPublisherSortQuery(sortField, sortOrder)
  return fetchAllPublisherPages(async (page) => {
    const response = await marketplaceClient.publisherTemplates({
      params: { uniqueHandle },
      query: { page, page_size: PAGE_SIZE, ...templates },
    })
    return {
      items: response.data?.templates ?? [],
      total: response.data?.total,
    }
  })
}

const getTemplateIcon = (template: MarketplaceTemplate) =>
  template.icon_file_key
    ? `${MARKETPLACE_API_PREFIX}/templates/${encodeURIComponent(template.id)}/icon`
    : ''

const getDependencyIcon = (pluginId: string) =>
  `${MARKETPLACE_API_PREFIX}/plugins/${pluginId.split('/').map(encodeURIComponent).join('/')}/icon`

const loadCreatorProfileCached = cache(
  async (
    uniqueHandle: string,
    publisherType: string | undefined,
    locale: string,
    sortField: CreatorSortField,
    sortOrder: CreatorSortOrder,
  ): Promise<LoadedCreatorProfile | null> => {
    const [creatorResult, pluginsResult, templatesResult] = await Promise.allSettled([
      getPublisher(uniqueHandle, publisherType),
      getPublisherPlugins(uniqueHandle, sortField, sortOrder),
      getPublisherTemplates(uniqueHandle, sortField, sortOrder),
    ])

    if (creatorResult.status === 'rejected') throw creatorResult.reason
    const creator = creatorResult.value
    if (!creator) return null

    const plugins: MarketplacePlugin[] =
      pluginsResult.status === 'fulfilled' ? pluginsResult.value : []
    const templates: MarketplaceTemplate[] =
      templatesResult.status === 'fulfilled' ? templatesResult.value : []
    const kind = publisherType === 'organization' ? 'organization' : 'individual'
    const resource = kind === 'organization' ? 'organizations' : 'creators'
    const encodedHandle = encodeURIComponent(uniqueHandle)
    const backgroundUrl = creator.background_image
      ? `${MARKETPLACE_API_PREFIX}/${resource}/${encodedHandle}/background-image`
      : ''
    const avatarUrl = creator.avatar
      ? `${MARKETPLACE_API_PREFIX}/${resource}/${encodedHandle}/avatar`
      : ''
    const viewModel = adaptCreatorProfile({
      creator,
      kind,
      locale,
      avatarUrl,
      backgroundUrl,
      plugins,
      templates,
      resolvePluginIcon: getPluginIconInMarketplace,
      resolveTemplateIcon: getTemplateIcon,
      resolveDependencyIcon: getDependencyIcon,
    })

    return {
      viewModel: {
        ...viewModel,
        creations: sortCreatorCreations(viewModel.creations, sortField, sortOrder),
      },
      pluginsByCreationId: Object.fromEntries(
        plugins.map((plugin) => [
          `${plugin.type}:${plugin.org}/${plugin.name}`,
          getFormattedPlugin(plugin),
        ]),
      ),
      templatesByCreationId: Object.fromEntries(
        templates.map((template) => [`template:${template.id}`, template]),
      ),
    }
  },
)

export const loadCreatorProfile = ({
  uniqueHandle,
  publisherType,
  locale,
  sortBy,
  sortOrder,
}: {
  uniqueHandle: string
  publisherType?: string
  locale: string
  sortBy?: string
  sortOrder?: string
}) =>
  loadCreatorProfileCached(
    uniqueHandle,
    publisherType,
    locale,
    parseCreatorSortField(sortBy),
    parseCreatorSortOrder(sortOrder),
  )
