import { skipToken } from '@tanstack/react-query'
import { consoleQuery } from './client'

const WORKFLOW_VERSIONS_PAGE_SIZE = 10

export function appWorkflowQueryOptions(appId: string | null | undefined) {
  return consoleQuery.apps.byAppId.workflows.publish.get.queryOptions({
    input: appId
      ? {
          params: {
            app_id: appId,
          },
        }
      : skipToken,
  })
}

export function appWorkflowVersionsInfiniteQueryOptions(appId: string | null | undefined) {
  return consoleQuery.apps.byAppId.workflows.get.infiniteOptions({
    input: appId
      ? (pageParam) => ({
          params: {
            app_id: appId,
          },
          query: {
            limit: WORKFLOW_VERSIONS_PAGE_SIZE,
            page: Number(pageParam),
          },
        })
      : skipToken,
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
    initialPageParam: 1,
  })
}

export function appWorkflowVersionsInfiniteQueryKey() {
  return consoleQuery.apps.byAppId.workflows.get.key({ type: 'infinite' })
}
