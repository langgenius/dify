import type { SystemFeatures } from '@/features/system-features/types'
import { type } from '@orpc/contract'
import { base } from '../base'

export const systemFeaturesContract = base
  .route({
    path: '/system-features',
    method: 'GET',
  })
  .output(type<SystemFeatures>())
