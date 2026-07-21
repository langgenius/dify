'use client'

import { keepPreviousData, skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom } from 'jotai/utils'
import { consoleQuery } from '@/service/client'
import { deploymentRouteAppInstanceIdAtom } from '../../route-state'

export const RELEASE_HISTORY_PAGE_SIZE = 20

export const releaseHistoryCurrentPageAtom = atom(0)

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

export const releaseHistoryAtom = selectAtom(releaseHistoryQueryAtom, (query) => query.data)
export const releaseHistoryIsLoadingAtom = selectAtom(
  releaseHistoryQueryAtom,
  (query) => query.isLoading,
)
export const releaseHistoryIsErrorAtom = selectAtom(
  releaseHistoryQueryAtom,
  (query) => query.isError,
)

export const setReleaseHistoryCurrentPageAtom = atom(null, (_get, set, page: number) => {
  set(releaseHistoryCurrentPageAtom, Math.max(page, 0))
})

export const adjustReleaseHistoryPageAfterDeleteAtom = atom(
  null,
  (get, set, remainingRowsOnPage: number) => {
    const currentPage = get(releaseHistoryCurrentPageAtom)
    if (remainingRowsOnPage === 1 && currentPage > 0)
      set(releaseHistoryCurrentPageAtom, currentPage - 1)
  },
)

export const releasesLocalAtoms = [releaseHistoryCurrentPageAtom] as const
