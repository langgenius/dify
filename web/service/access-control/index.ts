import type { AccessControlGroup, AccessMode, Subject } from '@/models/access-control'
import type { App } from '@/types/app'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '../client'
import {
  useAppWhiteListSubjects as useAppWhiteListSubjectsBase,
  useGetUserCanAccessApp as useGetUserCanAccessAppBase,
  useSearchForWhiteListCandidates as useSearchForWhiteListCandidatesBase,
} from './use-app-access-control'

const NAME_SPACE = 'access-control'

type UpdateAccessModeParams = {
  appId: App['id']
  subjects?: Pick<Subject, 'subjectId' | 'subjectType'>[]
  accessMode: AccessMode
}

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

export const useSearchForWhiteListCandidates = (query: SearchForWhiteListCandidatesQuery, enabled: boolean) => {
  return useSearchForWhiteListCandidatesBase(query, enabled)
}

export const useGetUserCanAccessApp = (params: UserCanAccessAppParams) => {
  return useGetUserCanAccessAppBase(params)
}

export const useUpdateAccessMode = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-access-mode'],
    mutationFn: (params: UpdateAccessModeParams) => {
      return consoleClient.enterprise.webAppAuth.updateWebAppWhitelistSubjects({
        body: params,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.enterprise.webAppAuth.getWebAppAccessMode.key({ type: 'query' }),
      })
      queryClient.invalidateQueries({
        queryKey: [NAME_SPACE, 'app-whitelist-subjects'],
      })
    },
  })
}
