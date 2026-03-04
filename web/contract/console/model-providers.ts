import type { ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { type } from '@orpc/contract'
import { base } from '../base'

export const modelProvidersModelsContract = base
  .route({
    path: '/workspaces/current/model-providers/{provider}/models',
    method: 'GET',
  })
  .input(type<{
    params: {
      provider: string
    }
  }>())
  .output(type<{
    data: ModelItem[]
  }>())
