'use client'

import type { App } from '@/types/app'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { isWorkflowApp } from '@/features/deployments/app-mode'
import { DEPLOYMENT_PAGE_SIZE, getNextPageParamFromPagination, SOURCE_APPS_PAGE_SIZE } from '@/features/deployments/data'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import {
  selectedAppAtom,
  sourceSearchTextAtom,
} from '../state/source-atoms'

export function useSourceAppsQuery(sourceSearchText: string, enabled = true) {
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

export function createEffectiveSelectedApp(selectedApp: App | undefined, sourceApps: App[]) {
  return isWorkflowApp(selectedApp) ? selectedApp : sourceApps[0]
}

export function useCreateGuideSourceApps({
  enabled = true,
}: {
  enabled?: boolean
} = {}) {
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const sourceAppsQuery = useSourceAppsQuery(sourceSearchText, enabled)
  const sourceApps = sourceAppsQuery.data?.pages.flatMap(page => page.data).filter(isWorkflowApp) ?? []
  const effectiveSelectedApp = createEffectiveSelectedApp(selectedApp, sourceApps)
  const sourceAppsLoading = sourceAppsQuery.isLoading || (sourceAppsQuery.isFetching && sourceApps.length === 0)

  return {
    effectiveSelectedApp,
    selectedApp,
    sourceApps,
    sourceAppsLoading,
    sourceAppsQuery,
    sourceSearchText,
  }
}

export function useCreateGuideExistingInstanceNames() {
  const appInstancesQuery = useExistingInstanceNamesQuery()
  const existingInstanceNames = appInstancesQuery.data?.pages.flatMap(page =>
    page.data.flatMap((appInstance) => {
      const name = appInstance.name.trim()
      return name ? [name] : []
    }),
  ) ?? []

  return {
    appInstancesQuery,
    existingInstanceNames,
  }
}

export function useInstanceNameConflict({
  existingInstanceNames,
  shouldCheck,
  submittedInstanceName,
}: {
  existingInstanceNames: readonly string[]
  shouldCheck: boolean
  submittedInstanceName: string
}) {
  const shouldCheckInstanceNameConflict = shouldCheck && Boolean(submittedInstanceName)
  const instanceNameConflictQuery = useQuery(consoleQuery.enterprise.appInstanceService.listAppInstances.queryOptions({
    input: {
      query: {
        pageNumber: 1,
        resultsPerPage: 1,
        name: submittedInstanceName,
      },
    },
    enabled: shouldCheckInstanceNameConflict,
  }))
  const remoteInstanceNameConflict = instanceNameConflictQuery.data?.data.some(appInstance =>
    appInstance.name.trim() === submittedInstanceName,
  )
  const isCheckingInstanceNameConflict = shouldCheckInstanceNameConflict && instanceNameConflictQuery.isLoading
  const hasInstanceNameConflict = Boolean(
    submittedInstanceName
    && (
      existingInstanceNames.includes(submittedInstanceName)
      || remoteInstanceNameConflict
    ),
  )

  return {
    hasInstanceNameConflict,
    instanceNameConflictQuery,
    isCheckingInstanceNameConflict,
  }
}
