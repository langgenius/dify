'use client'

import { keepPreviousData } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery } from 'jotai-tanstack-query'
import {
  DEPLOYMENT_PAGE_SIZE,
  getNextPageParamFromPagination,
  SOURCE_APPS_PAGE_SIZE,
} from '@/features/deployments/data'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import {
  deploymentTargetQueryEnabledAtom,
} from './deployment-target-query-atoms'
import {
  encodedDslContentAtom,
} from './dsl-atoms'
import { submittedReleaseFieldsAtom } from './release-atoms'
import {
  selectedAppAtom,
  sourceSearchTextAtom,
} from './source-atoms'
import { methodAtom } from './workflow-atoms'

export const sourceAppsQueryAtom = atomWithInfiniteQuery((get) => {
  const sourceSearchText = get(sourceSearchTextAtom)

  return {
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
    enabled: get(methodAtom) === 'bindApp',
  }
})

export const existingInstanceNamesQueryAtom = atomWithInfiniteQuery(() => ({
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
}))

export const instanceNameConflictQueryAtom = atomWithQuery((get) => {
  const submittedInstanceName = get(submittedReleaseFieldsAtom).submittedInstanceName

  return consoleQuery.enterprise.appInstanceService.listAppInstances.queryOptions({
    input: {
      query: {
        pageNumber: 1,
        resultsPerPage: 1,
        name: submittedInstanceName,
      },
    },
    enabled: Boolean(submittedInstanceName),
  })
})

export const deployableEnvironmentsQueryAtom = atomWithQuery((get) => {
  const enabled = get(deploymentTargetQueryEnabledAtom)

  return consoleQuery.enterprise.environmentService.listDeployableEnvironments.queryOptions({
    input: {
      query: {},
    },
    enabled,
  })
})

export const deploymentOptionsQueryAtom = atomWithQuery((get) => {
  const enabled = get(deploymentTargetQueryEnabledAtom)
  const method = get(methodAtom)
  const selectedApp = get(selectedAppAtom)

  const deploymentOptionsQueryOptions = method === 'importDsl'
    ? consoleQuery.enterprise.releaseService.getDeploymentOptionsFromDsl.queryOptions({
        input: {
          body: {
            dsl: get(encodedDslContentAtom),
          },
        },
        enabled,
      })
    : consoleQuery.enterprise.releaseService.getDeploymentOptionsFromSourceApp.queryOptions({
        input: {
          body: {
            sourceAppId: selectedApp?.id ?? '',
          },
        },
        enabled: enabled && Boolean(selectedApp?.id),
      })

  // oRPC encodes input before TanStack can skip work, so keep a valid input shape and gate requests with enabled.
  return {
    ...deploymentOptionsQueryOptions,
    retry: false,
  }
})

export const sourceAppsAtom = atom((get) => {
  const sourceAppsQuery = get(sourceAppsQueryAtom)

  return sourceAppsQuery.data?.pages.flatMap(page => page.data) ?? []
})

export const existingInstanceNamesAtom = atom((get) => {
  const appInstancesQuery = get(existingInstanceNamesQueryAtom)

  return appInstancesQuery.data?.pages.flatMap(page =>
    page.data.flatMap((appInstance) => {
      const name = appInstance.name.trim()

      return name ? [name] : []
    }),
  ) ?? []
})

export const remoteInstanceNameConflictAtom = atom((get) => {
  const submittedInstanceName = get(submittedReleaseFieldsAtom).submittedInstanceName
  if (!submittedInstanceName)
    return false

  const instanceNameConflictQuery = get(instanceNameConflictQueryAtom)

  return instanceNameConflictQuery.data?.data.some(appInstance => appInstance.name.trim() === submittedInstanceName) ?? false
})
