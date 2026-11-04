import { consoleClient } from '@/service/console'
import { selectAppParameters } from '@/service/console/app-parameters-select'

export const fetchTryAppDatasets = (appId: string, ids: string[]) => {
  return consoleClient.trialApps.byAppId.datasets.get({
    params: { app_id: appId },
    query: { ids },
  })
}

export const fetchTryAppParams = (appId: string) => {
  return consoleClient.trialApps.byAppId.parameters
    .get({ params: { app_id: appId } })
    .then(selectAppParameters)
}
