import type { WebAppAuthSearchForWhilteListCandidatesData } from '@dify/contracts/enterprise/types.gen'
import {
  useAppWhiteListSubjects as useAppWhiteListSubjectsBase,
  useGetUserCanAccessApp as useGetUserCanAccessAppBase,
  useSearchForWhiteListCandidates as useSearchForWhiteListCandidatesBase,
} from './use-app-access-control'

type SearchForWhiteListCandidatesQuery = Omit<
  NonNullable<WebAppAuthSearchForWhilteListCandidatesData['query']>,
  'pageNumber'
>

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
) => {
  return useSearchForWhiteListCandidatesBase(query, enabled)
}

export const useGetUserCanAccessApp = (params: UserCanAccessAppParams) => {
  return useGetUserCanAccessAppBase(params)
}
