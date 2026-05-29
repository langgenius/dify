import type { SystemFeatures } from '@/types/feature'
import { type } from '@orpc/contract'
import { base } from '../base'

export const systemFeaturesContract = base
  .route({
    path: '/system-features',
    method: 'GET',
  })
  .output(type<SystemFeatures>())

export const trialModelsContract = base
  .route({
    path: '/trial-models',
    method: 'GET',
  })
  .output(type<{
    trial_models: string[]
  }>())
