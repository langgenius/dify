import type { CollectionsAndPluginsSearchParams, MarketplaceCollection, PluginsSearchParams } from '@/app/components/plugins/marketplace/types'
import type { Plugin, PluginsFromMarketplaceResponse } from '@/app/components/plugins/types'
import { type } from '@orpc/contract'
import { base } from './base'

export const collectionsContract = base
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
