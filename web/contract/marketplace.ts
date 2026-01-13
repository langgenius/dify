import type { CollectionsAndPluginsSearchParams, MarketplaceCollection } from '@/app/components/plugins/marketplace/types'
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
