import type { AccessControlGroup, Subject } from '@/models/access-control'
import { useInfiniteQuery } from '@tanstack/react-query'
import { consoleClient } from '../client'

const NAME_SPACE = 'access-control'

type SearchAccessSubjectsResult = {
  currPage: number
  totalPages: number
  subjects: Subject[]
  hasMore: boolean
}

export type SearchAccessSubjectsQuery = {
  keyword?: string
  groupId?: AccessControlGroup['id']
  resultsPerPage?: number
}

export const useSearchAccessSubjects = (query: SearchAccessSubjectsQuery, enabled: boolean) => {
  const { keyword, groupId, resultsPerPage } = query

  return useInfiniteQuery({
    queryKey: [NAME_SPACE, 'access-subject-candidates', keyword, groupId, resultsPerPage],
    queryFn: async ({ pageParam }) => {
      const response = await consoleClient.enterprise.webAppAuth.searchForWhilteListCandidates({
        query: {
          ...(keyword ? { keyword } : {}),
          ...(groupId ? { groupId } : {}),
          ...(resultsPerPage ? { resultsPerPage } : {}),
          pageNumber: pageParam as number,
        },
      })

      return {
        currPage: response.currPage ?? (pageParam as number),
        totalPages: 0,
        subjects: (response.subjects ?? []) as Subject[],
        hasMore: response.hasMore ?? false,
      } satisfies SearchAccessSubjectsResult
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage.hasMore)
        return lastPage.currPage + 1
      return undefined
    },
    gcTime: 0,
    staleTime: 0,
    enabled,
  })
}
