import { useMutation, useQuery } from '@tanstack/react-query'
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
  has_more: boolean
}

export const useSearchForWhiteListCandidates = (query: { appId?: string; keyword?: string; pageNumber?: number; resultsPerPage?: number }, enabled: boolean) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'app-whitelist-candidates', query],
    queryFn: () => {
      const params = new URLSearchParams()
      Object.keys(query).forEach((key) => {
        const typedKey = key as keyof typeof query
        if (query[typedKey])
          params.append(key, `${query[typedKey]}`)
      })
      return get<SearchResults>(`/enterprise/webapp/app/subject/search?${new URLSearchParams(params).toString()}`)
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
