import { queryOptions } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'
import { fetchAppList } from '@/service/explore'
import {
  getHomeTemplatesInput,
  homeContinueWorkAppsInput,
  normalizeHomeTemplatesData,
  selectHomeContinueWorkApps,
} from './home-queries'

export function getHomeTemplatesQueryOptions(locale?: string) {
  const input = getHomeTemplatesInput(locale)
  const language = input.query?.language

  return queryOptions({
    queryKey: [...consoleQuery.explore.apps.get.queryKey({ input }), language],
    queryFn: () => fetchAppList(language).then(normalizeHomeTemplatesData),
  })
}

export function getHomeContinueWorkQueryOptions() {
  return consoleQuery.apps.recent.get.queryOptions({
    input: homeContinueWorkAppsInput,
    select: selectHomeContinueWorkApps,
  })
}
