import type { SystemFeatures } from '@/types/feature'
import { type } from '@orpc/contract'
import { base } from '../base'

export const systemFeaturesContract = base
  .route({
    path: '/system-features',
    method: 'GET',
  })
  .output(type<SystemFeatures>())

export const appDslVersionContract = base
  .route({
    path: '/app-dsl-version',
    method: 'GET',
  })
  .output(type<{
    app_dsl_version: string
  }>())
