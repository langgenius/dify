import { consoleQuery } from '@/service/client'
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
