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
