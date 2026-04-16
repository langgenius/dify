import type { WorkflowOnlineUsersResponse } from '@/models/app'
import { type } from '@orpc/contract'
import { base } from '../base'

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
    method: 'GET',
  })
  .input(type<{
    query: {
      app_ids: string
    }
  }>())
  .output(type<WorkflowOnlineUsersResponse>())
