import type { ChatConfig } from '@/app/components/base/chat/types'
import type { DataSetListResponse } from '@/models/datasets'
import type { TryAppFlowPreview, TryAppInfo } from '@/models/try-app'
import { type } from '@orpc/contract'
import { base } from '../base'

export const trialAppInfoContract = base
  .route({
    path: '/trial-apps/{appId}',
    method: 'GET',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<TryAppInfo>())

export const trialAppDatasetsContract = base
  .route({
    path: '/trial-apps/{appId}/datasets',
    method: 'GET',
  })
  .input(type<{
    params: {
      appId: string
    }
    query: {
      ids: string[]
    }
  }>())
  .output(type<DataSetListResponse>())

export const trialAppWorkflowsContract = base
  .route({
    path: '/trial-apps/{appId}/workflows',
    method: 'GET',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<TryAppFlowPreview>())

export const trialAppParametersContract = base
  .route({
    path: '/trial-apps/{appId}/parameters',
    method: 'GET',
  })
  .input(type<{
    params: {
      appId: string
    }
  }>())
  .output(type<ChatConfig>())
