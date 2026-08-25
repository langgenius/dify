import type {
  GetExploreAppsLearnDifyResponse,
  GetExploreAppsResponse,
  RecommendedAppDetailResponse,
  RecommendedAppInfoResponse,
  RecommendedAppResponse,
} from '@dify/contracts/api/console/explore/types.gen'
import type { App, AppCategory } from '@/models/explore'
import type { AppIconType } from '@/types/app'
import { consoleClient } from './client'

type ExploreAppsResponse = {
  categories: AppCategory[]
  recommended_apps: App[]
}

type LearnDifyAppsResponse = {
  recommended_apps: App[]
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

const normalizeAppMode = (value: unknown) => {
  return typeof value === 'string' ? value : ''
}

const isAppIconType = (value: unknown): value is AppIconType => {
  return value === 'image' || value === 'emoji' || value === 'link'
}

const normalizeAppIconType = (value: unknown) => {
  return isAppIconType(value) ? value : null
}

const normalizeAppBasicInfo = (
  source: RecommendedAppInfoResponse | null | undefined,
  fallbackId: string,
): App['app'] => {
  return {
    id: source?.id ?? fallbackId,
    mode: normalizeAppMode(source?.mode),
    icon_type: normalizeAppIconType(source?.icon_type),
    icon: source?.icon ?? '',
    icon_background: source?.icon_background ?? '',
    icon_url: source?.icon_url ?? '',
    name: source?.name ?? '',
    description: '',
    use_icon_as_answer_icon: false,
  }
}

const normalizeRecommendedApp = (app: RecommendedAppResponse): App => {
  return {
    app: normalizeAppBasicInfo(app.app, app.app_id),
    app_id: app.app_id,
    description: app.description ?? '',
    copyright: app.copyright ?? '',
    privacy_policy: app.privacy_policy ?? null,
    custom_disclaimer: app.custom_disclaimer ?? null,
    categories: app.categories ?? [],
    position: app.position ?? 0,
    is_listed: app.is_listed ?? false,
    install_count: 0,
    installed: false,
    editable: false,
    is_agent: false,
    can_trial: app.can_trial,
  }
}

const normalizeExploreAppsResponse = (response: GetExploreAppsResponse): ExploreAppsResponse => {
  return {
    categories: response.categories,
    recommended_apps: response.recommended_apps.map(normalizeRecommendedApp),
  }
}

const normalizeLearnDifyAppsResponse = (
  response: GetExploreAppsLearnDifyResponse,
): LearnDifyAppsResponse => {
  return {
    recommended_apps: response.recommended_apps.map(normalizeRecommendedApp),
  }
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
  return normalizeAppDetail(response)
}

export const fetchInstalledAppList = (appId?: string | null) => {
  if (!appId) return consoleClient.installedApps.get({})

  return consoleClient.installedApps.get({
    query: { app_id: appId },
  })
}
