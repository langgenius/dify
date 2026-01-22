import type { DataSetListResponse } from '@/models/datasets'
import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'
import { AppSourceType, fetchAppParams } from './share'
import { fetchTryAppDatasets, fetchTryAppFlowPreview, fetchTryAppInfo } from './try-app'

const NAME_SPACE = 'try-app'

export const useGetTryAppInfo = (appId: string) => {
  return useQuery({
    queryKey: consoleQuery.trialApps.info.queryKey({ input: { params: { appId } } }),
    queryFn: () => {
      return fetchTryAppInfo(appId)
    },
    enabled: !!appId,
  })
}

export const useGetTryAppParams = (appId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'appParams', appId],
    queryFn: () => {
      return fetchAppParams(AppSourceType.tryApp, appId)
    },
    enabled: !!appId,
  })
}

export const useGetTryAppDataSets = (appId: string, ids: string[]) => {
  return useQuery<DataSetListResponse>({
    queryKey: consoleQuery.trialApps.datasets.queryKey({ input: { params: { appId }, query: { ids } } }),
    queryFn: () => {
      return fetchTryAppDatasets(appId, ids)
    },
    enabled: ids.length > 0,
  })
}

export const useGetTryAppFlowPreview = (appId: string, disabled?: boolean) => {
  return useQuery({
    queryKey: consoleQuery.trialApps.workflows.queryKey({ input: { params: { appId } } }),
    enabled: !disabled,
    queryFn: () => {
      return fetchTryAppFlowPreview(appId)
    },
  })
}
