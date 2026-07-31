import type { RecentAppResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { GetExploreAppsResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { App } from '@/models/explore'
import type { ExploreAppsResponse } from '@/service/explore-normalizers'
import { normalizeExploreAppsResponse } from '@/service/explore-normalizers'

export type HomeTemplatesData = {
  categories: string[]
  allList: App[]
}

export const homeContinueWorkAppsInput = {
  query: {
    limit: 8,
  },
}

export function getHomeTemplatesInput(locale?: string) {
  return locale ? { query: { language: locale } } : {}
}

export function normalizeHomeTemplates(response: GetExploreAppsResponse): HomeTemplatesData {
  return normalizeHomeTemplatesData(normalizeExploreAppsResponse(response))
}

export function normalizeHomeTemplatesData(response: ExploreAppsResponse): HomeTemplatesData {
  return {
    categories: response.categories,
    allList: [...response.recommended_apps].sort((a, b) => a.position - b.position),
  }
}

export function selectHomeContinueWorkApps(response: {
  data: RecentAppResponse[]
}): RecentAppResponse[] {
  return response.data
}
