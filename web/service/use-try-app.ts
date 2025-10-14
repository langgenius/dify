import { useQuery } from '@tanstack/react-query'
import { fetchTryAppDatasets, fetchTryAppInfo } from './try-app'
import { AppSourceType, fetchAppParams } from './share'
import type { DataSetListResponse } from '@/models/datasets'

const NAME_SPACE = 'try-app'

export const useGetTryAppInfo = (appId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'appInfo'],
    queryFn: () => {
      return fetchTryAppInfo(appId)
    },
  })
}

export const useGetTryAppParams = (appId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'appParams'],
    queryFn: () => {
      return fetchAppParams(AppSourceType.tryApp, appId)
    },
  })
}

export const useGetTryAppDataSets = (appId: string, ids: string[]) => {
  return useQuery<DataSetListResponse>({
    queryKey: [NAME_SPACE, 'dataSets', ids],
    queryFn: () => {
      return fetchTryAppDatasets(appId, ids)
    },
    enabled: ids.length > 0,
  })
}
