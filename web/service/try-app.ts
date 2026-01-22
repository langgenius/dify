import type { ChatConfig } from '@/app/components/base/chat/types'
import type { DataSetListResponse } from '@/models/datasets'
import type { TryAppFlowPreview, TryAppInfo } from '@/models/try-app'
import { consoleClient } from '@/service/client'

export const fetchTryAppInfo = (appId: string): Promise<TryAppInfo> => {
  return consoleClient.trialApps.info({ params: { appId } })
}

export const fetchTryAppDatasets = (appId: string, ids: string[]): Promise<DataSetListResponse> => {
  return consoleClient.trialApps.datasets({
    params: { appId },
    query: { ids },
  })
}

export const fetchTryAppFlowPreview = (appId: string): Promise<TryAppFlowPreview> => {
  return consoleClient.trialApps.workflows({ params: { appId } })
    .then(res => res as TryAppFlowPreview)
}

export const fetchTryAppParams = (appId: string): Promise<ChatConfig> => {
  return consoleClient.trialApps.parameters({ params: { appId } })
}

export type { TryAppInfo } from '@/models/try-app'
