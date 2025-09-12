import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post } from './base'
import { getUserCanAccess } from './share'
import type { AccessControlAccount, AccessControlGroup, AccessMode, Subject } from '@/models/access-control'
import type { App } from '@/types/app'
import { useGlobalPublicStore } from '@/context/global-public-context'

const NAME_SPACE = 'access-control'

export const useAppWhiteListSubjects = (appId: string | undefined, enabled: boolean) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'app-whitelist-subjects', appId],
    queryFn: () => get<{ groups: AccessControlGroup[]; members: AccessControlAccount[] }>(`/enterprise/webapp/app/subjects?appId=${appId}`),
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

export const useSearchForWhiteListCandidates = (query: { keyword?: string; groupId?: AccessControlGroup['id']; resultsPerPage?: number }, enabled: boolean) => {
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
    gcTime: 0,
    staleTime: 0,
    enabled,
  })
}

type UpdateAccessModeParams = {
  appId: App['id']
  subjects?: Pick<Subject, 'subjectId' | 'subjectType'>[]
  accessMode: AccessMode
}

export const useUpdateAccessMode = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [NAME_SPACE, 'update-access-mode'],
    mutationFn: (params: UpdateAccessModeParams) => {
      return post('/enterprise/webapp/app/access-mode', { body: params })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [NAME_SPACE, 'app-whitelist-subjects'],
      })
    },
  })
}

export const useGetUserCanAccessApp = ({ appId, isInstalledApp = true, enabled }: { appId?: string; isInstalledApp?: boolean; enabled?: boolean }) => {
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  return useQuery({
    queryKey: [NAME_SPACE, 'user-can-access-app', appId],
    queryFn: () => {
      if (systemFeatures.webapp_auth.enabled)
        return getUserCanAccess(appId!, isInstalledApp)
      else
        return { result: true }
    },
    enabled: enabled !== undefined ? enabled : !!appId,
    staleTime: 0,
    gcTime: 0,
  })
}
