import type { MarketplaceCreator, MarketplaceOrganization } from '@dify/contracts/marketplace'
import type { CreatorSortField, CreatorSortOrder, LoadedCreatorProfile } from './model'
import { cache } from 'react'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { marketplaceClient } from '@/service/client'
import { getPluginIconInMarketplace } from '../utils'
import {
  adaptCreatorProfile,
  parseCreatorSortField,
  parseCreatorSortOrder,
  sortCreatorCreations,
} from './model'
import {
  fetchPublisherPluginPage,
  fetchPublisherTemplatePage,
  getDependencyIcon,
  getTemplateIcon,
  toCreatorRecords,
} from './publisher'
import 'server-only'

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
      fetchPublisherPluginPage({ uniqueHandle, page: 1, sortField, sortOrder }),
      fetchPublisherTemplatePage({ uniqueHandle, page: 1, sortField, sortOrder }),
    ])

    if (creatorResult.status === 'rejected') throw creatorResult.reason
    const creator = creatorResult.value
    if (!creator) return null

    const plugins = pluginsResult.status === 'fulfilled' ? pluginsResult.value.items : []
    const templates = templatesResult.status === 'fulfilled' ? templatesResult.value.items : []
    const pluginPage = pluginsResult.status === 'fulfilled' ? pluginsResult.value : undefined
    const templatePage = templatesResult.status === 'fulfilled' ? templatesResult.value : undefined
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
    const records = toCreatorRecords({ locale, plugins, templates })

    return {
      viewModel: {
        ...viewModel,
        creations: sortCreatorCreations(viewModel.creations, sortField, sortOrder),
      },
      pluginsByCreationId: records.pluginsByCreationId,
      templatesByCreationId: records.templatesByCreationId,
      inventory: {
        uniqueHandle,
        pluginHasMore: pluginPage?.hasMore ?? false,
        templateHasMore: templatePage?.hasMore ?? false,
        pluginNextPage: 2,
        templateNextPage: 2,
      },
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
