import type { SystemFeatures } from '@/types/feature'
import { type } from '@orpc/contract'
import { base } from '../base'

export const systemFeaturesContract = base
  .route({
    path: '/system-features',
    method: 'GET',
  })
  .input(type<unknown>())
  .output(type<SystemFeatures>())
