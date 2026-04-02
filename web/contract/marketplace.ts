import type {
  AddTemplateToCollectionRequest,
  BatchAddTemplatesToCollectionRequest,
  CollectionsAndPluginsSearchParams,
  CreateTemplateCollectionRequest,
  Creator,
  CreatorSearchParams,
  CreatorSearchResponse,
  GetCollectionTemplatesRequest,
  PluginCollection,
  PluginsSearchParams,
  SyncCreatorProfileRequest,
  TemplateCollection,
  TemplateDetail,
  TemplateSearchParams,
  TemplatesListResponse,
  UnifiedSearchParams,
  UnifiedSearchResponse,
} from '@/app/components/plugins/marketplace/types'
import type { Plugin, PluginsFromMarketplaceResponse } from '@/app/components/plugins/types'
import { type } from '@orpc/contract'
import { base } from './base'

export const pluginCollectionsContract = base
  .route({
    path: '/collections',
    method: 'GET',
  })
  .input(
    type<{
      query?: CollectionsAndPluginsSearchParams & { page?: number, page_size?: number }
    }>(),
  )
  .output(
    type<{
      data?: {
        collections?: PluginCollection[]
      }
    }>(),
  )

export const collectionPluginsContract = base
  .route({
    path: '/collections/{collectionId}/plugins',
    method: 'POST',
  })
  .input(
    type<{
      params: {
        collectionId: string
      }
      body?: CollectionsAndPluginsSearchParams
    }>(),
  )
  .output(
    type<{
      data?: {
        plugins?: Plugin[]
      }
    }>(),
  )

export const searchAdvancedContract = base
  .route({
    path: '/{kind}/search/advanced',
    method: 'POST',
  })
  .input(type<{
    params: {
      kind: 'plugins' | 'bundles'
    }
    body: Omit<PluginsSearchParams, 'type'>
  }>())
  .output(type<{ data: PluginsFromMarketplaceResponse }>())

export const templateCollectionsContract = base
  .route({
    path: '/template-collections',
    method: 'GET',
  })
  .input(
    type<{
      query?: {
        page?: number
        page_size?: number
        condition?: string
      }
    }>(),
  )
  .output(
    type<{
      data?: {
        collections?: TemplateCollection[]
        has_more?: boolean
        limit?: number
        page?: number
        total?: number
      }
    }>(),
  )

export const createTemplateCollectionContract = base
  .route({
    path: '/template-collections',
    method: 'POST',
  })
  .input(
    type<{
      body: CreateTemplateCollectionRequest
    }>(),
  )
  .output(type<TemplateCollection>())

export const getTemplateCollectionContract = base
  .route({
    path: '/template-collections/{collectionName}',
    method: 'GET',
  })
  .input(
    type<{
      params: {
        collectionName: string
      }
    }>(),
  )
  .output(type<TemplateCollection>())

export const deleteTemplateCollectionContract = base
  .route({
    path: '/template-collections/{collectionName}',
    method: 'DELETE',
  })
  .input(
    type<{
      params: {
        collectionName: string
      }
    }>(),
  )
  .output(type<void>())

export const getCollectionTemplatesContract = base
  .route({
    path: '/template-collections/{collectionName}/templates',
    method: 'POST',
  })
  .input(
    type<{
      params: {
        collectionName: string
      }
      body?: GetCollectionTemplatesRequest
    }>(),
  )
  .output(
    type<{
      data?: TemplatesListResponse
    }>(),
  )

export const addTemplateToCollectionContract = base
  .route({
    path: '/template-collections/{collectionName}/templates',
    method: 'PUT',
  })
  .input(
    type<{
      params: {
        collectionName: string
      }
      body: AddTemplateToCollectionRequest
    }>(),
  )
  .output(type<void>())

export const batchAddTemplatesToCollectionContract = base
  .route({
    path: '/template-collections/{collectionName}/templates/batch-add',
    method: 'POST',
  })
  .input(
    type<{
      params: {
        collectionName: string
      }
      body: BatchAddTemplatesToCollectionRequest
    }>(),
  )
  .output(type<void>())

export const clearCollectionTemplatesContract = base
  .route({
    path: '/template-collections/{collectionName}/templates/clear',
    method: 'PUT',
  })
  .input(
    type<{
      params: {
        collectionName: string
      }
    }>(),
  )
  .output(type<void>())

// Creators contracts
export const getCreatorByHandleContract = base
  .route({
    path: '/creators/{uniqueHandle}',
    method: 'GET',
  })
  .input(
    type<{
      params: {
        uniqueHandle: string
      }
    }>(),
  )
  .output(
    type<{
      data?: {
        creator?: Creator
      }
    }>(),
  )

export const getCreatorAvatarContract = base
  .route({
    path: '/creators/{uniqueHandle}/avatar',
    method: 'GET',
  })
  .input(
    type<{
      params: {
        uniqueHandle: string
      }
    }>(),
  )
  .output(type<Blob>())

export const syncCreatorProfileContract = base
  .route({
    path: '/creators/sync/profile',
    method: 'POST',
  })
  .input(
    type<{
      body: SyncCreatorProfileRequest
    }>(),
  )
  .output(
    type<{
      data?: {
        creator?: Creator
      }
    }>(),
  )

export const syncCreatorAvatarContract = base
  .route({
    path: '/creators/sync/avatar',
    method: 'POST',
  })
  .input(
    type<{
      body: FormData
    }>(),
  )
  .output(type<void>())

export const searchCreatorsAdvancedContract = base
  .route({
    path: '/creators/search/advanced',
    method: 'POST',
  })
  .input(
    type<{
      body: CreatorSearchParams
    }>(),
  )
  .output(
    type<{
      data?: CreatorSearchResponse
    }>(),
  )

// Templates public endpoints
export const getTemplatesListContract = base
  .route({
    path: '/templates',
    method: 'GET',
  })
  .input(
    type<{
      query?: {
        page?: number
        page_size?: number
        categories?: string
      }
    }>(),
  )
  .output(
    type<{
      data?: TemplatesListResponse
    }>(),
  )

export const getTemplateByIdContract = base
  .route({
    path: '/templates/{templateId}',
    method: 'GET',
  })
  .input(
    type<{
      params: {
        templateId: string
      }
    }>(),
  )
  .output(
    type<{
      data?: TemplateDetail
    }>(),
  )

export const getTemplateDslFileContract = base
  .route({
    path: '/templates/{templateId}/file',
    method: 'GET',
  })
  .input(
    type<{
      params: {
        templateId: string
      }
    }>(),
  )
  .output(type<Blob>())

export const searchTemplatesBasicContract = base
  .route({
    path: '/templates/search/basic',
    method: 'POST',
  })
  .input(
    type<{
      body: TemplateSearchParams
    }>(),
  )
  .output(
    type<{
      data?: TemplatesListResponse
    }>(),
  )

export const searchTemplatesAdvancedContract = base
  .route({
    path: '/templates/search/advanced',
    method: 'POST',
  })
  .input(
    type<{
      body: TemplateSearchParams
    }>(),
  )
  .output(
    type<{
      data?: TemplatesListResponse
    }>(),
  )

export const searchUnifiedContract = base
  .route({
    path: '/search/unified',
    method: 'POST',
  })
  .input(
    type<{
      body: UnifiedSearchParams
    }>(),
  )
  .output(
    type<UnifiedSearchResponse>(),
  )

export const getPublisherTemplatesContract = base
  .route({
    path: '/templates/publisher/{uniqueHandle}',
    method: 'GET',
  })
  .input(
    type<{
      params: {
        uniqueHandle: string
      }
      query?: {
        page?: number
        page_size?: number
      }
    }>(),
  )
  .output(
    type<{
      data?: TemplatesListResponse
    }>(),
  )

export const getPublisherPluginsContract = base
  .route({
    path: '/plugins/publisher/{uniqueHandle}',
    method: 'GET',
  })
  .input(
    type<{
      params: {
        uniqueHandle: string
      }
      query?: {
        page?: number
        page_size?: number
      }
    }>(),
  )
  .output(
    type<{
      data?: PluginsFromMarketplaceResponse
    }>(),
  )
