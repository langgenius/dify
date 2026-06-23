'use client'

import type { ListAppInstanceSummariesResponse } from '@dify/contracts/enterprise/types.gen'
import type { InfiniteData, QueryKey } from '@tanstack/react-query'
import { keepPreviousData } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithInfiniteQuery, atomWithQuery } from 'jotai-tanstack-query'
import { parseAsString } from 'nuqs'
import { consoleQuery } from '@/service/client'
import { getNextPageParamFromPagination, SOURCE_APPS_PAGE_SIZE } from '../../shared/domain/pagination'
import { deploymentStatusPollingInterval } from '../../shared/domain/runtime-status'

export const envFilterQueryState = parseAsString.withOptions({ history: 'push' })
export const keywordsQueryState = parseAsString.withDefault('').withOptions({ history: 'push' })

export const deploymentsListKeywordsAtom = atom('')
export const deploymentsListEnvironmentIdAtom = atom<string | null>(null)

function listDeploymentStatusPollingInterval(data?: InfiniteData<ListAppInstanceSummariesResponse>) {
  const rows = data?.pages?.flatMap(page =>
    page.appInstanceSummaries.flatMap(summary => summary.environmentDeployments),
  ) ?? []

  return deploymentStatusPollingInterval(rows)
}

export const deploymentsListQueryAtom = atomWithInfiniteQuery<
  ListAppInstanceSummariesResponse,
  Error,
  InfiniteData<ListAppInstanceSummariesResponse>,
  QueryKey,
  number
>((get) => {
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
    refetchInterval: query => listDeploymentStatusPollingInterval(query.state.data),
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

export const environmentsFilterQueryAtom = atomWithQuery(() =>
  consoleQuery.enterprise.environmentService.listEnvironments.queryOptions({
    input: {
      query: {
        // The filter lists every deployable environment; environment count is
        // capped well below the 100-per-page maximum.
        pageNumber: 1,
        resultsPerPage: 100,
      },
    },
  }),
)
