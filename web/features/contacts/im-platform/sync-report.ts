import type { ImSyncResultItem } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { ContactImRepositoryError, ContactImRepositoryErrorCode } from './types'

export const syncResults = ['added', 'not_matched', 'failed', 'removed', 'skipped'] as const

export async function loadContactImSyncReport(queryClient: QueryClient, runId: string) {
  const api = consoleQuery.workspaces.current.humanInput.v2.imSyncRuns.latest
  const { run } = await queryClient.query(
    api.get.queryOptions({ context: { silent: true }, staleTime: 0 }),
  )
  if (run.id !== runId || run.status === 'queued' || run.status === 'running')
    throw new ContactImRepositoryError(ContactImRepositoryErrorCode.SyncRunNotFound)
  const items: ImSyncResultItem[] = []
  const itemIds = new Set<string>()
  for (const result of syncResults) {
    let page = 1
    let count = 0
    while (true) {
      const response = await queryClient.query(
        api.results.get.queryOptions({
          input: { query: { result, page, limit: 100 } },
          context: { silent: true },
          staleTime: 0,
        }),
      )
      if (response.page !== page)
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.PageLoadFailed)
      for (const item of response.data) {
        if (item.result.type !== result || itemIds.has(item.id))
          throw new ContactImRepositoryError(ContactImRepositoryErrorCode.PageLoadFailed)
        itemIds.add(item.id)
        items.push(item)
      }
      count += response.data.length
      if (response.page * response.limit >= response.total) break
      if (response.data.length === 0)
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.PageLoadFailed)
      page += 1
    }
    if (count !== run.result_counts[result])
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.PageLoadFailed)
  }
  const { run: current } = await queryClient.query(
    api.get.queryOptions({ context: { silent: true }, staleTime: 0 }),
  )
  if (
    current.id !== run.id ||
    current.status !== run.status ||
    current.finished_at !== run.finished_at ||
    syncResults.some((result) => current.result_counts[result] !== run.result_counts[result])
  )
    throw new ContactImRepositoryError(ContactImRepositoryErrorCode.SyncRunNotFound)
  return { run, items }
}
