import type { ServerConsoleClientContext } from '@/service/server'
import { queryOptions } from '@tanstack/react-query'
import { serverConsoleClient, serverConsoleQuery } from '@/service/server'
import {
  getHomeTemplatesInput,
  homeContinueWorkAppsInput,
  normalizeHomeTemplates,
  selectHomeContinueWorkApps,
} from './home-queries'
import 'server-only'

export function getHomeTemplatesServerQueryOptions(
  locale: string,
  context: ServerConsoleClientContext,
) {
  const input = getHomeTemplatesInput(locale)
  const language = input.query?.language

  // oxlint-disable-next-line @tanstack/query/exhaustive-deps -- Server request context must not partition the client-compatible hydration key.
  return queryOptions({
    queryKey: [...serverConsoleQuery.explore.apps.get.queryKey({ input }), language],
    queryFn: () =>
      serverConsoleClient.explore.apps.get(input, { context }).then(normalizeHomeTemplates),
    retry: false,
  })
}

export function getHomeContinueWorkServerQueryOptions(context: ServerConsoleClientContext) {
  return serverConsoleQuery.apps.recent.get.queryOptions({
    context,
    input: homeContinueWorkAppsInput,
    retry: false,
    select: selectHomeContinueWorkApps,
  })
}
