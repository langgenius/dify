import type { WorkflowOnlineUsersResponse } from '@/models/app'
import { type } from '@orpc/contract'
import { base } from '../base'

export const workflowOnlineUsersContract = base
  .route({
    path: '/apps/workflows/online-users',
    method: 'GET',
  })
  .input(type<{
    query: {
      workflow_ids: string
    }
  }>())
  .output(type<WorkflowOnlineUsersResponse>())
