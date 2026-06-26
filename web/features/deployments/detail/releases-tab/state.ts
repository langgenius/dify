'use client'

import { keepPreviousData, skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/client'
import { deploymentRouteAppInstanceIdAtom } from '../../route-state'
import { RELEASE_HISTORY_PAGE_SIZE } from '../../shared/domain/pagination'

export const releaseHistoryCurrentPageAtom = atom(0)
export const deployReleaseMenuOpenReleaseIdAtom = atom<string | undefined>(undefined)

export const releaseHistoryQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentRouteAppInstanceIdAtom)
  const currentPage = get(releaseHistoryCurrentPageAtom)

  return consoleQuery.enterprise.releaseService.listReleaseSummaries.queryOptions({
    input: appInstanceId
      ? {
          params: { appInstanceId },
          query: {
            pageNumber: currentPage + 1,
            resultsPerPage: RELEASE_HISTORY_PAGE_SIZE,
          },
        }
      : skipToken,
    enabled: Boolean(appInstanceId),
    placeholderData: keepPreviousData,
  })
})

export const deployReleaseMenuEnvironmentDeploymentsQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentRouteAppInstanceIdAtom)
  const openReleaseId = get(deployReleaseMenuOpenReleaseIdAtom)

  return consoleQuery.enterprise.deploymentService.listEnvironmentDeployments.queryOptions({
    input: appInstanceId
      ? {
          params: { appInstanceId },
        }
      : skipToken,
    enabled: Boolean(appInstanceId && openReleaseId),
  })
})

export const deployReleaseMenuAppInstanceQueryAtom = atomWithQuery((get) => {
  const appInstanceId = get(deploymentRouteAppInstanceIdAtom)
  const openReleaseId = get(deployReleaseMenuOpenReleaseIdAtom)

  return consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: appInstanceId
      ? {
          params: { appInstanceId },
        }
      : skipToken,
    enabled: Boolean(appInstanceId && openReleaseId),
  })
})

export const setReleaseHistoryCurrentPageAtom = atom(null, (_get, set, page: number) => {
  set(releaseHistoryCurrentPageAtom, Math.max(page, 0))
})

export const adjustReleaseHistoryPageAfterDeleteAtom = atom(null, (get, set, remainingRowsOnPage: number) => {
  const currentPage = get(releaseHistoryCurrentPageAtom)
  if (remainingRowsOnPage === 1 && currentPage > 0)
    set(releaseHistoryCurrentPageAtom, currentPage - 1)
})

export const setDeployReleaseMenuOpenAtom = atom(null, (get, set, {
  releaseId,
  open,
}: {
  releaseId: string
  open: boolean
}) => {
  if (open) {
    set(deployReleaseMenuOpenReleaseIdAtom, releaseId)
    return
  }

  if (get(deployReleaseMenuOpenReleaseIdAtom) === releaseId)
    set(deployReleaseMenuOpenReleaseIdAtom, undefined)
})

export const releasesTabLocalAtoms = [
  releaseHistoryCurrentPageAtom,
  deployReleaseMenuOpenReleaseIdAtom,
] as const
