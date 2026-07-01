import type { InferContractRouterInputs } from '@orpc/contract'
import type { CollectionsAndPluginsSearchParams, MarketplaceCollection, PluginsSearchParams } from '@/app/components/plugins/marketplace/types'
import type { Plugin, PluginsFromMarketplaceResponse } from '@/app/components/plugins/types'
import type { MarketplaceTemplate } from '@/types/marketplace-template'
import { type } from '@orpc/contract'
import { base } from './base'

const collectionsContract = base
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
        collections?: MarketplaceCollection[]
      }
    }>(),
  )

const collectionPluginsContract = base
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

const searchAdvancedContract = base
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

const templateDetailContract = base
  .route({
    path: '/templates/{templateId}',
    method: 'GET',
  })
  .input(type<{
    params: {
      templateId: string
    }
  }>())
  .output(type<{ data: MarketplaceTemplate }>())

const downloadPluginContract = base
  .route({
    path: '/plugins/{organization}/{pluginName}/{version}/download',
    method: 'GET',
  })
  .input(type<{
    params: {
      organization: string
      pluginName: string
      version: string
    }
  }>())
  .output(type<Blob>())

export const marketplaceRouterContract = {
  collections: collectionsContract,
  collectionPlugins: collectionPluginsContract,
  searchAdvanced: searchAdvancedContract,
  templateDetail: templateDetailContract,
  downloadPlugin: downloadPluginContract,
}

export type MarketPlaceInputs = InferContractRouterInputs<typeof marketplaceRouterContract>
