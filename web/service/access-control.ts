import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { get, post } from './base'
import type { AccessControlAccount, AccessControlGroup, Subject } from '@/models/access-control'
import type { App } from '@/types/app'

const NAME_SPACE = 'access-control'

export const useAppWhiteListSubjects = (appId: string, enabled: boolean) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'app-whitelist-subjects', appId],
    queryFn: () => get<{ groups: AccessControlGroup[]; members: AccessControlAccount[] }>(`/enterprise/webapp/app/subjects?appId=${appId}`),
    enabled,
  })
}

type SearchResults = {
  currPage: number
  totalPages: number
  subjects: Subject[]
  hasMore: boolean
}

export const useSearchForWhiteListCandidates = (query: { keyword?: string; resultsPerPage?: number }, enabled: boolean) => {
  return useInfiniteQuery({
    queryKey: [NAME_SPACE, 'app-whitelist-candidates', query],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      Object.keys(query).forEach((key) => {
        const typedKey = key as keyof typeof query
        if (query[typedKey])
          params.append(key, `${query[typedKey]}`)
      })
      params.append('pageNumber', `${pageParam}`)
      return get<SearchResults>(`/enterprise/webapp/app/subject/search?${new URLSearchParams(params).toString()}`)
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage.hasMore)
        return lastPage.currPage + 1
      return undefined
    },
    enabled,
  })
}

type UpdateAccessModeParams = {
  appId: App['id']
  subjects: Subject['subjectId'][]
}

export const useUpdateAccessMode = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-access-mode'],
    mutationFn: (params: UpdateAccessModeParams) => {
      return post('/enterprise/webapp/app/access-mode', { body: params })
    },
  })
}
