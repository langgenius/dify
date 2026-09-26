import type { DataSourceNotionWorkspace } from '@/models/common'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { get } from '../base'

type PreImportNotionPagesParams = {
  datasetId: string
  credentialId: string
}

type PreImportNotionPagesResponse = {
  notion_info: DataSourceNotionWorkspace[]
  next_cursor?: string | null
}

export const PRE_IMPORT_NOTION_PAGES_QUERY_KEY = 'notion-pre-import-pages'
export const NOTION_PRE_IMPORT_PAGE_SIZE = 50

export const mergeNotionPreImportPages = (
  pages: PreImportNotionPagesResponse[],
): DataSourceNotionWorkspace[] => {
  const byWorkspace = new Map<string, DataSourceNotionWorkspace>()
  for (const batch of pages) {
    for (const workspace of batch.notion_info) {
      const key = workspace.workspace_id ?? ''
      const existing = byWorkspace.get(key)
      if (existing) {
        existing.pages = [...existing.pages, ...workspace.pages]
      } else {
        byWorkspace.set(key, { ...workspace, pages: [...workspace.pages] })
      }
    }
  }
  return [...byWorkspace.values()]
}

export const usePreImportNotionPages = ({
  datasetId,
  credentialId,
}: PreImportNotionPagesParams) => {
  const query = useInfiniteQuery({
    queryKey: [PRE_IMPORT_NOTION_PAGES_QUERY_KEY, datasetId, credentialId],
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      return get<PreImportNotionPagesResponse>('/notion/pre-import/pages', {
        params: {
          dataset_id: datasetId,
          credential_id: credentialId,
          page_size: NOTION_PRE_IMPORT_PAGE_SIZE,
          ...(pageParam ? { start_cursor: pageParam } : {}),
        },
      })
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    retry: 0,
    enabled: Boolean(credentialId),
  })

  useEffect(() => {
    if (query.hasNextPage && !query.isFetchingNextPage && !query.isLoading) {
      void query.fetchNextPage()
    }
  }, [query.dataUpdatedAt, query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage, query.isLoading])

  const notion_info = useMemo(
    () => (query.data ? mergeNotionPreImportPages(query.data.pages) : undefined),
    [query.data],
  )

  return {
    data: notion_info ? { notion_info } : undefined,
    isFetching: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    isError: query.isError,
  }
}

export const useInvalidPreImportNotionPages = () => {
  const queryClient = useQueryClient()
  return ({ datasetId, credentialId }: PreImportNotionPagesParams) => {
    queryClient.invalidateQueries({
      queryKey: [PRE_IMPORT_NOTION_PAGES_QUERY_KEY, datasetId, credentialId],
    })
  }
}
