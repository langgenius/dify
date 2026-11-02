import type {
  Subject as ApiSubject,
  WebAppAuthSearchForWhilteListCandidatesData,
} from '@dify/contracts/enterprise/types.gen'
import type { Subject } from '@/models/access-control'
import { useInfiniteQuery, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { SubjectType } from '@/models/access-control'
import { consoleQuery } from '@/service/console'
import { getUserCanAccess } from '../share'

const NAME_SPACE = 'access-control'

export const useAppWhiteListSubjects = (appId: string | undefined, enabled: boolean) => {
  return useQuery({
    ...consoleQuery.enterprise.webAppAuth.getWebAppWhitelistSubjects.queryOptions({
      input: { query: { appId } },
    }),
    enabled: !!appId && enabled,
    staleTime: 0,
    gcTime: 0,
    select: ({ groups, members }) => ({
      groups: (groups ?? []).flatMap((group) => {
        if (!group.id || !group.name || group.groupSize === undefined) return []
        return [{ id: group.id, name: group.name, groupSize: group.groupSize }]
      }),
      members: (members ?? []).flatMap((member) => {
        if (!member.id || !member.name || !member.email) return []
        return [
          {
            id: member.id,
            name: member.name,
            email: member.email,
            avatar: member.avatar ?? '',
            avatarUrl: member.avatar ?? '',
          },
        ]
      }),
    }),
  })
}

type SearchForWhiteListCandidatesQuery = Omit<
  NonNullable<WebAppAuthSearchForWhilteListCandidatesData['query']>,
  'pageNumber'
>

function selectCandidate(subject: ApiSubject): Subject[] {
  if (!subject.subjectId) return []
  if (subject.subjectType === SubjectType.GROUP) {
    const group = subject.groupData
    if (!group?.id || !group.name) return []
    return [
      {
        subjectId: subject.subjectId,
        subjectType: SubjectType.GROUP,
        groupData: { id: group.id, name: group.name, groupSize: group.groupSize ?? 0 },
      },
    ]
  }
  if (subject.subjectType === SubjectType.ACCOUNT) {
    const account = subject.accountData
    if (!account?.id || !account.name || !account.email) return []
    return [
      {
        subjectId: subject.subjectId,
        subjectType: SubjectType.ACCOUNT,
        accountData: {
          id: account.id,
          name: account.name,
          email: account.email,
          avatar: account.avatar ?? '',
          avatarUrl: account.avatar ?? '',
        },
      },
    ]
  }
  return []
}

export const useSearchForWhiteListCandidates = (
  query: SearchForWhiteListCandidatesQuery,
  enabled: boolean,
) => {
  return useInfiniteQuery(
    consoleQuery.enterprise.webAppAuth.searchForWhilteListCandidates.infiniteOptions({
      input: (pageParam: number) => ({
        query: {
          keyword: query.keyword || undefined,
          groupId: query.groupId || undefined,
          resultsPerPage: query.resultsPerPage || undefined,
          pageNumber: pageParam,
        },
      }),
      initialPageParam: 1,
      getNextPageParam: (lastPage, _pages, lastPageParam) =>
        lastPage.hasMore ? (lastPage.currPage ?? lastPageParam) + 1 : undefined,
      select: (data) => ({
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          subjects: (page.subjects ?? []).flatMap(selectCandidate),
        })),
      }),
      gcTime: 0,
      staleTime: 0,
      enabled,
    }),
  )
}

export const useGetUserCanAccessApp = ({
  appId,
  isInstalledApp = true,
  enabled,
}: {
  appId?: string
  isInstalledApp?: boolean
  enabled?: boolean
}) => {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const webappAuthEnabled = systemFeatures.webapp_auth.enabled
  return useQuery({
    queryKey: [NAME_SPACE, 'user-can-access-app', appId, webappAuthEnabled, isInstalledApp],
    queryFn: () => {
      if (webappAuthEnabled) return getUserCanAccess(appId!, isInstalledApp)
      else return { result: true }
    },
    enabled: enabled !== undefined ? enabled : !!appId,
    staleTime: 0,
    gcTime: 0,
  })
}
