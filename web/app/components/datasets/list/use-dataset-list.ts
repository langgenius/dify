import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleQuery } from '@/service/client'

type DatasetListQuery = {
  creatorIds: string[]
  includeAll: boolean
  keyword: string
  tagIds: string[]
}

export const useDatasetList = ({ creatorIds, includeAll, keyword, tagIds }: DatasetListQuery) => {
  return useInfiniteQuery(
    consoleQuery.datasets.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          page: Number(pageParam),
          limit: 30,
          include_all: includeAll,
          ...(tagIds.length > 0 ? { tag_ids: tagIds } : {}),
          ...(creatorIds.length > 0 ? { creator_ids: creatorIds } : {}),
          ...(keyword ? { keyword } : {}),
        },
      }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
  )
}

export const useInvalidDatasetList = () => {
  const queryClient = useQueryClient()

  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
  }, [queryClient])
}
