import { useQuery } from '@tanstack/react-query'
import { get } from './base'
import type { AccessControlAccount, AccessControlGroup, Subject } from '@/models/access-control'

const NAME_SPACE = 'access-control'

export const useAppWhiteListSubjects = (appId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'app-whitelist-subjects', appId],
    queryFn: () => get<{ groups: AccessControlGroup[]; members: AccessControlAccount[] }>(`/enterprise/webapp/app/subjects?appId=${appId}`),
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
