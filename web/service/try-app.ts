import type { ChatConfig } from '@/app/components/base/chat/types'
import type { DataSetListResponse } from '@/models/datasets'
import type { TryAppFlowPreview, TryAppInfo } from '@/models/try-app'
import { consoleClient } from '@/service/client'

export const fetchTryAppInfo = (appId: string): Promise<TryAppInfo> => {
  return consoleClient.trialApps.byAppId.get({ params: { app_id: appId } })
    .then(res => res as TryAppInfo)
}

export const fetchTryAppDatasets = (appId: string, ids: string[]): Promise<DataSetListResponse> => {
  return consoleClient.trialApps.byAppId.datasets.get({
    params: { app_id: appId },
    query: { ids },
  }).then(res => res as DataSetListResponse)
}

export const fetchTryAppFlowPreview = (appId: string): Promise<TryAppFlowPreview> => {
  return consoleClient.trialApps.byAppId.workflows.get({ params: { app_id: appId } })
    .then(res => res as TryAppFlowPreview)
}

export const fetchTryAppParams = (appId: string): Promise<ChatConfig> => {
  return consoleClient.trialApps.byAppId.parameters.get({ params: { app_id: appId } })
    .then(res => res as ChatConfig)
}

export type { TryAppInfo } from '@/models/try-app'
