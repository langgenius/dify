import { consoleQuery } from '@/service/console'
import { taskGraphIsActive } from './model'
import { backgroundTaskFromApi } from './models'
import { responseStatus } from './request-error'
import { TASK_PAGE_SIZE } from './tasks/recovery'

export function logicalDocumentsInfiniteOptions(knowledgeSpaceId: string) {
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.infiniteOptions({
    input: (pageParam) => ({
      params: { control_space_id: knowledgeSpaceId },
      query: {
        ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
      },
    }),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    initialPageParam: null as string | null,
  })
}

export function documentTasksInfiniteOptions(
  knowledgeSpaceId: string,
  { enabled }: { enabled: boolean },
) {
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.infiniteOptions({
    enabled,
    input: (pageParam) => ({
      params: { control_space_id: knowledgeSpaceId },
      query: {
        limit: TASK_PAGE_SIZE,
        ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
      },
    }),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    refetchInterval: (query) => {
      if (responseStatus(query.state.error) === 403) return false
      return query.state.data?.pages.some((page) =>
        page.data.some((task) => taskGraphIsActive(backgroundTaskFromApi(task))),
      )
        ? 5000
        : false
    },
    initialPageParam: null as string | null,
  })
}

export function documentSourcesInfiniteOptions(
  knowledgeSpaceId: string,
  { enabled }: { enabled: boolean },
) {
  return consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.infiniteOptions({
    enabled,
    input: (pageParam) => ({
      params: { control_space_id: knowledgeSpaceId },
      query: {
        ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
      },
    }),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    initialPageParam: null as string | null,
  })
}
