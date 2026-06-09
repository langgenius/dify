import type { ModelItem, PreferredProviderTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CommonResponse } from '@/models/common'
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

export const changePreferredProviderTypeContract = base
  .route({
    path: '/workspaces/current/model-providers/{provider}/preferred-provider-type',
    method: 'POST',
  })
  .input(type<{
    params: {
      provider: string
    }
    body: {
      preferred_provider_type: PreferredProviderTypeEnum
    }
  }>())
  .output(type<CommonResponse>())
