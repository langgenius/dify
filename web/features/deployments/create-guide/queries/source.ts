'use client'

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { DEPLOYMENT_PAGE_SIZE, getNextPageParamFromPagination, SOURCE_APPS_PAGE_SIZE } from '@/features/deployments/data'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'

export function useSourceAppsQuery({
  enabled = true,
  sourceSearchText,
}: {
  enabled?: boolean
  sourceSearchText: string
}) {
  return useInfiniteQuery({
    ...consoleQuery.apps.list.infiniteOptions({
      input: pageParam => ({
        query: {
          page: Number(pageParam),
          limit: SOURCE_APPS_PAGE_SIZE,
          name: sourceSearchText,
          mode: AppModeEnum.WORKFLOW,
        },
      }),
      getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
    enabled,
  })
}

export function useExistingInstanceNamesQuery() {
  return useInfiniteQuery({
    ...consoleQuery.enterprise.appInstanceService.listAppInstances.infiniteOptions({
      input: pageParam => ({
        query: {
          pageNumber: Number(pageParam),
          resultsPerPage: DEPLOYMENT_PAGE_SIZE,
        },
      }),
      getNextPageParam: lastPage => getNextPageParamFromPagination(lastPage.pagination),
      initialPageParam: 1,
    }),
    placeholderData: keepPreviousData,
  })
}

export function useInstanceNameConflictQuery({
  enabled,
  submittedInstanceName,
}: {
  enabled: boolean
  submittedInstanceName: string
}) {
  return useQuery(consoleQuery.enterprise.appInstanceService.listAppInstances.queryOptions({
    input: {
      query: {
        pageNumber: 1,
        resultsPerPage: 1,
        name: submittedInstanceName,
      },
    },
    enabled: enabled && Boolean(submittedInstanceName),
  }))
}

type ExistingInstanceNamesQueryData = ReturnType<typeof useExistingInstanceNamesQuery>['data']
type InstanceNameConflictQueryData = ReturnType<typeof useInstanceNameConflictQuery>['data']

export function existingInstanceNamesFromQueryData(data: ExistingInstanceNamesQueryData) {
  return data?.pages.flatMap(page =>
    page.data.flatMap((appInstance) => {
      const name = appInstance.name.trim()
      return name ? [name] : []
    }),
  ) ?? []
}

export function instanceNameConflictFromQueryData(data: InstanceNameConflictQueryData, submittedInstanceName: string) {
  const instanceName = submittedInstanceName.trim()

  if (!instanceName)
    return false

  return data?.data.some(appInstance => appInstance.name.trim() === instanceName) ?? false
}
