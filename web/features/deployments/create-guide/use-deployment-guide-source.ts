'use client'

import type { App } from '@/types/app'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { isWorkflowApp } from '../app-mode'
import { DEPLOYMENT_PAGE_SIZE, getNextPageParamFromPagination, SOURCE_APPS_PAGE_SIZE } from '../data'

export function useDeploymentGuideSource() {
  const [sourceSearchText, setSourceSearchText] = useState('')
  const [selectedApp, setSelectedApp] = useState<App>()
  const sourceAppsQuery = useInfiniteQuery({
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
  })
  const appInstancesQuery = useInfiniteQuery({
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
  const sourceApps = sourceAppsQuery.data?.pages.flatMap(page => page.data).filter(isWorkflowApp) ?? []
  const effectiveSelectedApp = isWorkflowApp(selectedApp) ? selectedApp : sourceApps[0]
  const existingInstanceNames = appInstancesQuery.data?.pages.flatMap(page => page.data ?? []).map(appInstance => appInstance.name?.trim()).filter((name): name is string => Boolean(name)) ?? []

  return {
    effectiveSelectedApp,
    existingInstanceNames,
    selectedApp,
    setSelectedApp,
    setSourceSearchText,
    sourceApps,
    sourceAppsLoading: sourceAppsQuery.isLoading || (sourceAppsQuery.isFetching && sourceApps.length === 0),
    sourceSearchText,
  }
}
