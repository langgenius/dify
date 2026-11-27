import { skipToken } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { selectAppParameters } from '@/service/console/app-parameters-select'

export function tryAppParamsQueryOptions(appId: string) {
  return consoleQuery.trialApps.byAppId.parameters.get.queryOptions({
    input: appId ? { params: { app_id: appId } } : skipToken,
    select: selectAppParameters,
  })
}

export function tryAppDatasetsQueryOptions(appId: string, ids: string[]) {
  return consoleQuery.trialApps.byAppId.datasets.get.queryOptions({
    input: ids.length > 0 ? { params: { app_id: appId }, query: { ids } } : skipToken,
  })
}
