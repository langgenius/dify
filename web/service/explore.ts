import type { RecommendedAppDetailResponse } from '@dify/contracts/api/console/explore/types.gen'
import { consoleClient } from './client'
import { normalizeExploreAppsResponse, normalizeLearnDifyAppsResponse } from './explore-normalizers'

const normalizeAppMode = (value: unknown) => {
  return typeof value === 'string' ? value : ''
}

type ExploreAppDetailResponse = {
  id: string
  name: string
  icon: string
  icon_background: string
  mode: string
  export_data: string
  can_trial: boolean
}

const normalizeAppDetail = (response: RecommendedAppDetailResponse): ExploreAppDetailResponse => {
  return {
    id: response.id,
    name: response.name,
    icon: response.icon ?? '',
    icon_background: response.icon_background ?? '',
    mode: normalizeAppMode(response.mode),
    export_data: response.export_data,
    can_trial: response.can_trial,
  }
}

export const fetchAppList = (language?: string) => {
  if (!language) return consoleClient.explore.apps.get({}).then(normalizeExploreAppsResponse)

  return consoleClient.explore.apps
    .get({
      query: { language },
    })
    .then(normalizeExploreAppsResponse)
}

export const fetchLearnDifyAppList = (language?: string) => {
  if (!language)
    return consoleClient.explore.apps.learnDify.get({}).then(normalizeLearnDifyAppsResponse)

  return consoleClient.explore.apps.learnDify
    .get({
      query: { language },
    })
    .then(normalizeLearnDifyAppsResponse)
}

export const fetchAppDetail = async (id: string): Promise<ExploreAppDetailResponse> => {
  const response = await consoleClient.explore.apps.byAppId.get({
    params: { app_id: id },
  })
  if (!response) throw new Error('Recommended app not found')
  return normalizeAppDetail(response)
}

export const fetchInstalledAppList = (appId?: string | null) => {
  if (!appId) return consoleClient.installedApps.get({})

  return consoleClient.installedApps.get({
    query: { app_id: appId },
  })
}
