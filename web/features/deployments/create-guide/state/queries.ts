'use client'

import type { Getter } from 'jotai/vanilla'
import { keepPreviousData, skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery } from 'jotai-tanstack-query'
import { encodeDslContent } from '@/features/deployments/shared/domain/dsl'
import { consoleQuery } from '@/service/client'
import { effectiveMethodAtom, instanceNameAtom, submissionUnsupportedDslNodesAtom } from './primitives'
import { dslContentAtom, effectiveSelectedAppAtom, sourceReady } from './source'
import { DEPLOYMENT_PAGE_SIZE, getNextPageParamFromPagination } from './utils'

export const existingInstanceNamesQueryAtom = atomWithInfiniteQuery(() =>
  consoleQuery.enterprise.appInstanceService.listAppInstances.infiniteOptions({
    input: pageParam => ({
      query: {
        pageNumber: Number(pageParam),
        resultsPerPage: DEPLOYMENT_PAGE_SIZE,
      },
    }),
    getNextPageParam: lastPage => getNextPageParamFromPagination(lastPage.pagination),
    initialPageParam: 1,
    placeholderData: keepPreviousData,
  }),
)

export const instanceNameConflictQueryAtom = atomWithQuery((get) => {
  const submittedInstanceName = get(instanceNameAtom).trim()

  return consoleQuery.enterprise.appInstanceService.listAppInstances.queryOptions({
    input: {
      query: {
        pageNumber: 1,
        resultsPerPage: 1,
        displayName: submittedInstanceName,
      },
    },
    enabled: Boolean(submittedInstanceName),
  })
})

export const deployableEnvironmentsQueryAtom = atomWithQuery((get) => {
  return consoleQuery.enterprise.environmentService.listEnvironments.queryOptions({
    input: {
      query: {
        // The guide offers every deployable environment at once; environment
        // count is capped well below the 100-per-page maximum.
        pageNumber: 1,
        resultsPerPage: 100,
      },
    },
    enabled: sourceReady(get),
  })
})

const precheckReleaseQueryAtom = atomWithQuery((get) => {
  const method = get(effectiveMethodAtom)
  const effectiveSelectedApp = get(effectiveSelectedAppAtom)
  const dslContent = get(dslContentAtom)
  const encodedDslContent = dslContent.trim() ? encodeDslContent(dslContent) : undefined
  const enabled = sourceReady(get)

  // PrecheckRelease takes exactly one source arm (dsl | sourceAppId).
  const precheckReleaseQueryOptions = method === 'importDsl'
    ? consoleQuery.enterprise.releaseService.precheckRelease.queryOptions({
        input: encodedDslContent
          ? {
              body: {
                dsl: encodedDslContent,
              },
            }
          : skipToken,
        enabled,
        retry: false,
      })
    : consoleQuery.enterprise.releaseService.precheckRelease.queryOptions({
        input: effectiveSelectedApp?.id
          ? {
              body: {
                sourceAppId: effectiveSelectedApp.id,
              },
            }
          : skipToken,
        enabled: enabled && Boolean(effectiveSelectedApp?.id),
        retry: false,
      })

  return precheckReleaseQueryOptions
})

function precheckReleaseReady(get: Getter) {
  const precheckReleaseQuery = get(precheckReleaseQueryAtom)

  return sourceReady(get)
    && precheckReleaseQuery.isSuccess
    && Boolean(precheckReleaseQuery.data?.canCreate)
    && (precheckReleaseQuery.data?.unsupportedNodes.length ?? 0) === 0
    && get(submissionUnsupportedDslNodesAtom).length === 0
}

export const deploymentOptionsQueryAtom = atomWithQuery((get) => {
  const method = get(effectiveMethodAtom)
  const effectiveSelectedApp = get(effectiveSelectedAppAtom)
  const dslContent = get(dslContentAtom)
  const encodedDslContent = dslContent.trim() ? encodeDslContent(dslContent) : undefined
  const enabled = precheckReleaseReady(get)

  // ComputeDeploymentOptions takes exactly one source arm (dsl | sourceAppId | releaseId).
  const deploymentOptionsQueryOptions = method === 'importDsl'
    ? consoleQuery.enterprise.releaseService.computeDeploymentOptions.queryOptions({
        input: encodedDslContent
          ? {
              body: {
                dsl: encodedDslContent,
              },
            }
          : skipToken,
        enabled,
        retry: false,
      })
    : consoleQuery.enterprise.releaseService.computeDeploymentOptions.queryOptions({
        input: effectiveSelectedApp?.id
          ? {
              body: {
                sourceAppId: effectiveSelectedApp.id,
              },
            }
          : skipToken,
        enabled: enabled && Boolean(effectiveSelectedApp?.id),
        retry: false,
      })

  return deploymentOptionsQueryOptions
})

export const unsupportedDslNodesAtom = atom((get) => {
  const submissionUnsupportedDslNodes = get(submissionUnsupportedDslNodesAtom)
  if (submissionUnsupportedDslNodes.length > 0)
    return submissionUnsupportedDslNodes

  if (!sourceReady(get))
    return []

  return get(precheckReleaseQueryAtom).data?.unsupportedNodes ?? []
})

const precheckReleaseReadyAtom = atom((get) => {
  return precheckReleaseReady(get)
})

export const deploymentOptionsReadyAtom = atom((get) => {
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  return sourceReady(get)
    && get(precheckReleaseReadyAtom)
    && deploymentOptionsQuery.isSuccess
})

export const deploymentOptionsContentCheckedAtom = atom((get) => {
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)
  const precheckReleaseQuery = get(precheckReleaseQueryAtom)
  const isLoadingOptions = deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data)
  const isCheckingReleaseContent = precheckReleaseQuery.isLoading || (precheckReleaseQuery.isFetching && !precheckReleaseQuery.data)

  if (!sourceReady(get) || isCheckingReleaseContent || isLoadingOptions)
    return false

  return get(precheckReleaseReadyAtom) && deploymentOptionsQuery.isSuccess
})
