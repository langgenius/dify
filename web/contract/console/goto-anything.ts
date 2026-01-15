import type { AppListResponse } from '@/models/app'
import type { DataSetListResponse } from '@/models/datasets'
import { type } from '@orpc/contract'
import { base } from '../base'

export const searchAppsContract = base
  .route({
    path: '/apps',
    method: 'GET',
  })
  .input(type<{
    query?: {
      page?: number
      limit?: number
      name?: string
    }
  }>())
  .output(type<AppListResponse>())

export const searchDatasetsContract = base
  .route({
    path: '/datasets',
    method: 'GET',
  })
  .input(type<{
    query?: {
      page?: number
      limit?: number
      keyword?: string
    }
  }>())
  .output(type<DataSetListResponse>())
