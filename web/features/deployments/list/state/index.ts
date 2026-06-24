'use client'

import type { ReactNode } from 'react'
import { keepPreviousData } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery } from 'jotai-tanstack-query'
import { useHydrateAtoms } from 'jotai/utils'
import { parseAsString, useQueryState } from 'nuqs'
import { consoleQuery } from '@/service/client'
import { getNextPageParamFromPagination, SOURCE_APPS_PAGE_SIZE } from '../../shared/domain/pagination'
import { deploymentStatusPollingInterval } from '../../shared/domain/runtime-status'

export const envFilterQueryState = parseAsString.withOptions({ history: 'push' })
export const keywordsQueryState = parseAsString.withDefault('').withOptions({ history: 'push' })

// Mirrors nuqs URL state. DeploymentsListStateBoundary force-hydrates these
// atoms on render so query atoms can read URL filters through Jotai.
const deploymentsListKeywordsAtom = atom('')
const deploymentsListEnvironmentIdAtom = atom<string | null>(null)

export function DeploymentsListStateBoundary({ children }: {
  children: ReactNode
}) {
  const [envFilter] = useQueryState('env', envFilterQueryState)
  const [keywords] = useQueryState('keywords', keywordsQueryState)

  useHydrateAtoms([
    [deploymentsListEnvironmentIdAtom, envFilter],
    [deploymentsListKeywordsAtom, keywords],
  ] as const, { dangerouslyForceHydrate: true })

  return children
}

export const deploymentsListQueryAtom = atomWithInfiniteQuery((get) => {
  const queryKeywords = get(deploymentsListKeywordsAtom).trim()
  const queryEnvironmentId = get(deploymentsListEnvironmentIdAtom) ?? undefined

  return consoleQuery.enterprise.appInstanceService.listAppInstanceSummaries.infiniteOptions({
    input: pageParam => ({
      query: {
        pageNumber: Number(pageParam),
        resultsPerPage: SOURCE_APPS_PAGE_SIZE,
        ...(queryEnvironmentId ? { environmentId: queryEnvironmentId } : {}),
        ...(queryKeywords ? { displayName: queryKeywords } : {}),
      },
    }),
    getNextPageParam: lastPage => getNextPageParamFromPagination(lastPage.pagination),
    initialPageParam: 1,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const rows = query.state.data?.pages.flatMap(page =>
        page.appInstanceSummaries.flatMap(summary => summary.environmentDeployments),
      ) ?? []

      return deploymentStatusPollingInterval(rows)
    },
  })
})

export const deploymentsListRowsAtom = atom((get) => {
  return get(deploymentsListQueryAtom).data?.pages.flatMap(page => page.appInstanceSummaries) ?? []
})

export const deploymentsListShowSkeletonAtom = atom((get) => {
  const deploymentsListQuery = get(deploymentsListQueryAtom)
  const pages = deploymentsListQuery.data?.pages ?? []

  return deploymentsListQuery.isLoading || (deploymentsListQuery.isFetching && pages.length === 0)
})

export const deploymentsListShowEmptyStateAtom = atom((get) => {
  return !get(deploymentsListShowSkeletonAtom)
    && !get(deploymentsListQueryAtom).isError
    && get(deploymentsListRowsAtom).length === 0
})

export const deploymentsListHasFilterAtom = atom((get) => {
  return Boolean(get(deploymentsListKeywordsAtom).trim() || get(deploymentsListEnvironmentIdAtom))
})
