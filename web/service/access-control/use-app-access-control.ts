import type { AccessControlAccount, AccessControlGroup, Subject } from '@/models/access-control'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions, webAppSystemFeaturesQueryOptions } from '@/features/system-features/client'
import { get } from '../base'
import { getUserCanAccess } from '../share'

const NAME_SPACE = 'access-control'

export const useAppWhiteListSubjects = (appId: string | undefined, enabled: boolean) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'app-whitelist-subjects', appId],
    queryFn: () => get<{ groups: AccessControlGroup[], members: AccessControlAccount[] }>(`/enterprise/webapp/app/subjects?appId=${appId}`),
    enabled: !!appId && enabled,
    staleTime: 0,
    gcTime: 0,
  })
}

type SearchResults = {
  currPage: number
  totalPages: number
  subjects: Subject[]
  hasMore: boolean
}

type SearchForWhiteListCandidatesQuery = {
  keyword?: string
  groupId?: AccessControlGroup['id']
  resultsPerPage?: number
}

export const useSearchForWhiteListCandidates = (query: SearchForWhiteListCandidatesQuery, enabled: boolean) => {
  const { keyword, groupId, resultsPerPage } = query

  return useInfiniteQuery({
    queryKey: [NAME_SPACE, 'app-whitelist-candidates', keyword, groupId, resultsPerPage],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (keyword)
        params.append('keyword', keyword)
      if (groupId)
        params.append('groupId', groupId)
      if (resultsPerPage)
        params.append('resultsPerPage', `${resultsPerPage}`)
      params.append('pageNumber', `${pageParam}`)
      return get<SearchResults>(`/enterprise/webapp/app/subject/search?${new URLSearchParams(params).toString()}`)
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

export const useGetUserCanAccessApp = ({ appId, isInstalledApp = true, enabled }: { appId?: string, isInstalledApp?: boolean, enabled?: boolean }) => {
  // useQuery (not useSuspenseQuery) to keep this service hook's call contract
  // unchanged from the zustand era: callers should not need a Suspense boundary.
  // First-fetch undefined is bridged via `?? false` so the inner queryKey is stable.
  const { data: systemFeatures } = useQuery(
    isInstalledApp ? systemFeaturesQueryOptions() : webAppSystemFeaturesQueryOptions(),
  )
  const webappAuthEnabled = systemFeatures?.webapp_auth.enabled ?? false
  return useQuery({
    queryKey: [NAME_SPACE, 'user-can-access-app', appId, webappAuthEnabled, isInstalledApp],
    queryFn: () => {
      if (webappAuthEnabled)
        return getUserCanAccess(appId!, isInstalledApp)
      else
        return { result: true }
    },
    enabled: enabled !== undefined ? enabled : !!appId,
    staleTime: 0,
    gcTime: 0,
  })
}
