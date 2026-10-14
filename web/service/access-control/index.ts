import type { QueryMeta } from '@tanstack/react-query'
import type { AccessControlGroup } from '@/models/access-control'
import {
  useAppWhiteListSubjects as useAppWhiteListSubjectsBase,
  useGetUserCanAccessApp as useGetUserCanAccessAppBase,
  useSearchForWhiteListCandidates as useSearchForWhiteListCandidatesBase,
} from './use-app-access-control'

type SearchForWhiteListCandidatesQuery = {
  keyword?: string
  groupId?: AccessControlGroup['id']
  resultsPerPage?: number
}

type UserCanAccessAppParams = {
  appId?: string
  isInstalledApp?: boolean
  enabled?: boolean
}

export const useAppWhiteListSubjects = (appId: string | undefined, enabled: boolean) => {
  return useAppWhiteListSubjectsBase(appId, enabled)
}

export const useSearchForWhiteListCandidates = (
  query: SearchForWhiteListCandidatesQuery,
  enabled: boolean,
  options?: { meta?: QueryMeta },
) => {
  return useSearchForWhiteListCandidatesBase(query, enabled, options)
}

export const useGetUserCanAccessApp = (params: UserCanAccessAppParams) => {
  return useGetUserCanAccessAppBase(params)
}
