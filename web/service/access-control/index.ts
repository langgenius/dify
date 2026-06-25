import type { AccessControlGroup, AccessMode, Subject } from '@/models/access-control'
import type { App } from '@/types/app'
import { AccessSubjectType } from '@dify/contracts/enterprise/types.gen'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { SubjectType } from '@/models/access-control'
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

const normalizeSubjectType = (subjectType: Subject['subjectType']) => {
  if (subjectType === SubjectType.GROUP)
    return AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP

  if (subjectType === SubjectType.ACCOUNT)
    return AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT

  return subjectType
}

const normalizeUpdateAccessModeParams = (params: UpdateAccessModeParams) => ({
  appId: params.appId,
  accessMode: params.accessMode,
  subjects: params.subjects?.map(subject => ({
    subjectId: subject.subjectId,
    subjectType: normalizeSubjectType(subject.subjectType),
  })),
})

export const useUpdateAccessMode = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [NAME_SPACE, 'update-access-mode'],
    mutationFn: (params: UpdateAccessModeParams) => {
      return consoleClient.explore.updateAppAccessMode({
        body: normalizeUpdateAccessModeParams(params),
      })
    },
    onSuccess: () => {
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.explore.appAccessMode.key({ type: 'query' }),
        }),
        queryClient.invalidateQueries({
          queryKey: [NAME_SPACE, 'app-whitelist-subjects'],
        }),
      ])
    },
  })
}
