import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'
import {
  fetchTryAppDatasets,
  fetchTryAppFlowPreview,
  fetchTryAppInfo,
  fetchTryAppParams,
} from './try-app'

export const useGetTryAppInfo = (appId: string) => {
  return useQuery({
    queryKey: consoleQuery.trialApps.byAppId.get.queryKey({ input: { params: { app_id: appId } } }),
    queryFn: () => {
      return fetchTryAppInfo(appId)
    },
    enabled: !!appId,
  })
}

export const useGetTryAppParams = (appId: string) => {
  return useQuery({
    queryKey: consoleQuery.trialApps.byAppId.parameters.get.queryKey({
      input: { params: { app_id: appId } },
    }),
    queryFn: () => {
      return fetchTryAppParams(appId)
    },
    enabled: !!appId,
  })
}

export const useGetTryAppDataSets = (appId: string, ids: string[]) => {
  return useQuery({
    queryKey: consoleQuery.trialApps.byAppId.datasets.get.queryKey({
      input: { params: { app_id: appId }, query: { ids } },
    }),
    queryFn: () => {
      return fetchTryAppDatasets(appId, ids)
    },
    enabled: ids.length > 0,
  })
}

export const useGetTryAppFlowPreview = (appId: string, disabled?: boolean) => {
  return useQuery({
    queryKey: consoleQuery.trialApps.byAppId.workflows.get.queryKey({
      input: { params: { app_id: appId } },
    }),
    enabled: !disabled,
    queryFn: () => {
      return fetchTryAppFlowPreview(appId)
    },
  })
}
