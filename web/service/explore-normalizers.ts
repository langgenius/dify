import type {
  GetExploreAppsLearnDifyResponse,
  GetExploreAppsResponse,
  RecommendedAppInfoResponse,
  RecommendedAppResponse,
} from '@dify/contracts/api/console/explore/types.gen'
import type { App, AppCategory } from '@/models/explore'
import type { AppIconType } from '@/types/app'

export type ExploreAppsResponse = {
  categories: AppCategory[]
  recommended_apps: App[]
}

export type LearnDifyAppsResponse = {
  recommended_apps: App[]
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

export const normalizeExploreAppsResponse = (
  response: GetExploreAppsResponse,
): ExploreAppsResponse => {
  return {
    categories: response.categories,
    recommended_apps: response.recommended_apps.map(normalizeRecommendedApp),
  }
}

export const normalizeLearnDifyAppsResponse = (
  response: GetExploreAppsLearnDifyResponse,
): LearnDifyAppsResponse => {
  return {
    recommended_apps: response.recommended_apps.map(normalizeRecommendedApp),
  }
}
