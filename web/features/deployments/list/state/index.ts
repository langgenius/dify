'use client'

import type { ReactNode } from 'react'
import { keepPreviousData } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery } from 'jotai-tanstack-query'
import { selectAtom, useHydrateAtoms } from 'jotai/utils'
import { parseAsString, useQueryState } from 'nuqs'
import { consoleQuery } from '@/service/client'
import { deploymentStatusPollingInterval } from '../../shared/domain/runtime-status'

const DEPLOYMENTS_LIST_PAGE_SIZE = 100

export const envFilterQueryState = parseAsString.withOptions({ history: 'push' })
export const keywordsQueryState = parseAsString.withDefault('').withOptions({ history: 'push' })

// Mirrors nuqs URL state. DeploymentsListStateBoundary force-hydrates these
// atoms on render so query atoms can read URL filters through Jotai.
const deploymentsListKeywordsAtom = atom('')
const deploymentsListEnvironmentIdAtom = atom<string | null>(null)

export type DeploymentsListEnvironmentFilterOption = {
  kind: 'all' | 'environment'
  value: string | null
  displayName?: string
}

export function DeploymentsListStateBoundary({ children }: { children: ReactNode }) {
  const [envFilter] = useQueryState('env', envFilterQueryState)
  const [keywords] = useQueryState('keywords', keywordsQueryState)

  useHydrateAtoms(
    [
      [deploymentsListEnvironmentIdAtom, envFilter],
      [deploymentsListKeywordsAtom, keywords],
    ] as const,
    { dangerouslyForceHydrate: true },
  )

  return children
}

const deploymentsListEnvironmentsQueryAtom = atomWithQuery(() => {
  return consoleQuery.enterprise.environmentService.listEnvironments.queryOptions({
    input: {
      query: {
        // The filter lists every deployable environment; environment count is
        // capped well below the 100-per-page maximum.
        pageNumber: 1,
        resultsPerPage: 100,
      },
    },
  })
})

const deploymentsListEnvironmentsDataAtom = selectAtom(
  deploymentsListEnvironmentsQueryAtom,
  (query) => query.data,
)

export const deploymentsListEnvironmentFilterOptionsAtom = atom(
  (get): DeploymentsListEnvironmentFilterOption[] => {
    const environments = get(deploymentsListEnvironmentsDataAtom)?.environments ?? []

    return [
      {
        kind: 'all',
        value: null,
      },
      ...environments.map((environment) => ({
        kind: 'environment' as const,
        value: environment.id,
        displayName: environment.displayName,
      })),
    ]
  },
)

export const deploymentsListSelectedEnvironmentFilterOptionAtom = atom(
  (get): DeploymentsListEnvironmentFilterOption => {
    const envFilter = get(deploymentsListEnvironmentIdAtom)
    const options = get(deploymentsListEnvironmentFilterOptionsAtom)
    const allOption = options[0] ?? { kind: 'all' as const, value: null }

    return (
      options.find((option) => option.value === envFilter) ??
      (envFilter
        ? {
            kind: 'environment',
            value: envFilter,
            displayName: envFilter,
          }
        : allOption)
    )
  },
)

const deploymentsListQueryAtom = atomWithInfiniteQuery((get) => {
  const queryKeywords = get(deploymentsListKeywordsAtom).trim()
  const queryEnvironmentId = get(deploymentsListEnvironmentIdAtom) ?? undefined

  return consoleQuery.enterprise.appInstanceService.listAppInstanceSummaries.infiniteOptions({
    input: (pageParam) => ({
      query: {
        pageNumber: Number(pageParam),
        resultsPerPage: DEPLOYMENTS_LIST_PAGE_SIZE,
        ...(queryEnvironmentId ? { environmentId: queryEnvironmentId } : {}),
        ...(queryKeywords ? { displayName: queryKeywords } : {}),
      },
    }),
    getNextPageParam: (lastPage) => {
      const currentPage = lastPage.pagination?.currentPage ?? 1
      const totalPages = lastPage.pagination?.totalPages ?? 1

      return currentPage < totalPages ? currentPage + 1 : undefined
    },
    initialPageParam: 1,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const rows =
        query.state.data?.pages.flatMap((page) =>
          page.appInstanceSummaries.flatMap((summary) => summary.environmentDeployments),
        ) ?? []

      return deploymentStatusPollingInterval(rows)
    },
  })
})

const deploymentsListDataAtom = selectAtom(deploymentsListQueryAtom, (query) => query.data)
export const deploymentsListErrorAtom = selectAtom(deploymentsListQueryAtom, (query) => query.error)
export const deploymentsListFetchNextPageAtom = selectAtom(
  deploymentsListQueryAtom,
  (query) => query.fetchNextPage,
)
export const deploymentsListHasNextPageAtom = selectAtom(
  deploymentsListQueryAtom,
  (query) => query.hasNextPage,
)
export const deploymentsListIsFetchingAtom = selectAtom(
  deploymentsListQueryAtom,
  (query) => query.isFetching,
)
export const deploymentsListIsFetchingNextPageAtom = selectAtom(
  deploymentsListQueryAtom,
  (query) => query.isFetchingNextPage,
)
export const deploymentsListIsLoadingAtom = selectAtom(
  deploymentsListQueryAtom,
  (query) => query.isLoading,
)
const deploymentsListIsErrorAtom = selectAtom(deploymentsListQueryAtom, (query) => query.isError)

export const deploymentsListRowsAtom = atom((get) => {
  return get(deploymentsListDataAtom)?.pages.flatMap((page) => page.appInstanceSummaries) ?? []
})

export const deploymentsListShowSkeletonAtom = atom((get) => {
  const pages = get(deploymentsListDataAtom)?.pages ?? []

  return (
    get(deploymentsListIsLoadingAtom) || (get(deploymentsListIsFetchingAtom) && pages.length === 0)
  )
})

export const deploymentsListShowEmptyStateAtom = atom((get) => {
  return (
    !get(deploymentsListShowSkeletonAtom) &&
    !get(deploymentsListIsErrorAtom) &&
    get(deploymentsListRowsAtom).length === 0
  )
})

export const deploymentsListShowErrorStateAtom = atom((get) => {
  return !get(deploymentsListShowSkeletonAtom) && get(deploymentsListIsErrorAtom)
})

export const deploymentsListHasFilterAtom = atom((get) => {
  return Boolean(get(deploymentsListKeywordsAtom).trim() || get(deploymentsListEnvironmentIdAtom))
})
