import type { AppListResponse, WorkflowOnlineUsersResponse } from '@/models/app'
import type { AppModeEnum } from '@/types/app'
import { type } from '@orpc/contract'
import { base } from '../base'

export type AppListQuery = {
  page?: number
  limit?: number
  name?: string
  mode?: AppModeEnum
  tag_ids?: string[]
  is_created_by_me?: boolean
}

export const appListContract = base
  .route({
    path: '/apps',
    method: 'GET',
  })
  .input(type<{
    query?: AppListQuery
  }>())
  .output(type<AppListResponse>())

export const appDeleteContract = base
  .route({
    path: '/apps/{appId}',
    method: 'DELETE',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<unknown>())

export const workflowOnlineUsersContract = base
  .route({
    path: '/apps/workflows/online-users',
    method: 'POST',
  })
  .input(type<{
    body: {
      app_ids: string[]
    }
  }>())
  .output(type<WorkflowOnlineUsersResponse>())
