import type { WorkflowTypeConversionTarget } from '@/types/workflow'
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

export const appWorkflowTypeConvertContract = base
  .route({
    path: '/apps/{appId}/workflows/convert-type',
    method: 'POST',
  })
  .input(type<{
    params: {
      appId: string
    }
    query: {
      target_type: WorkflowTypeConversionTarget
    }
  }>())
  .output(type<unknown>())
