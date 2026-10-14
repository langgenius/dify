import type { QueryMeta } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { fetchTryAppDatasets, fetchTryAppParams } from './try-app'

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

export const useGetTryAppDataSets = (
  appId: string,
  ids: string[],
  { meta }: { meta?: QueryMeta } = {},
) => {
  return useQuery({
    meta,
    queryKey: consoleQuery.trialApps.byAppId.datasets.get.queryKey({
      input: { params: { app_id: appId }, query: { ids } },
    }),
    queryFn: () => {
      return fetchTryAppDatasets(appId, ids)
    },
    enabled: ids.length > 0,
  })
}
