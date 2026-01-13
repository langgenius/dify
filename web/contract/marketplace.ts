import type { CollectionsAndPluginsSearchParams, MarketplaceCollection } from '@/app/components/plugins/marketplace/types'
import type { Plugin } from '@/app/components/plugins/types'
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
