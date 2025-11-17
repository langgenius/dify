import { useQuery } from '@tanstack/react-query'
import { fetchTryAppDatasets, fetchTryAppFlowPreview, fetchTryAppInfo } from './try-app'
import { AppSourceType, fetchAppParams } from './share'
import type { DataSetListResponse } from '@/models/datasets'

const NAME_SPACE = 'try-app'

export const useGetTryAppInfo = (appId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'appInfo', appId],
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
    queryKey: [NAME_SPACE, 'dataSets', appId, ids],
    queryFn: () => {
      return fetchTryAppDatasets(appId, ids)
    },
    enabled: ids.length > 0,
  })
}

export const useGetTryAppFlowPreview = (appId: string, disabled?: boolean) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'preview', appId],
    enabled: !disabled,
    queryFn: () => {
      return fetchTryAppFlowPreview(appId)
    },
  })
}
