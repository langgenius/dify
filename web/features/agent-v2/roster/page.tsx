'use client'

import type { AgentPublicationCountsResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentRosterListState } from './components/agent-roster-list'
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useQueryState, useQueryStates } from 'nuqs'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { TagManagementDialog } from '@/features/tag-management/tag-management-dialog'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/console'
import { AgentRosterList } from './components/agent-roster-list'
import { RosterToolbar } from './components/roster-toolbar'
import {
  rosterCreatedByMeQueryParser,
  rosterFilterQueryParser,
  rosterKeywordQueryParser,
  rosterQueryParamNames,
  rosterSortByQueryParser,
  rosterTagIdsQueryParser,
} from './query-params'

const ROSTER_PAGE_SIZE = 30
const rosterFilters = {
  [rosterQueryParamNames.keyword]: rosterKeywordQueryParser,
  [rosterQueryParamNames.filter]: rosterFilterQueryParser,
  [rosterQueryParamNames.createdByMe]: rosterCreatedByMeQueryParser,
  [rosterQueryParamNames.tagIds]: rosterTagIdsQueryParser,
}
const EMPTY_PUBLICATION_COUNTS: AgentPublicationCountsResponse = {
  drafts: 0,
  published: 0,
}

export default function RosterPage() {
  const { t } = useTranslation(['agentRoster'])
  const queryClient = useQueryClient()
  const docLink = useDocLink()
  const [filters, setFilters] = useQueryStates(rosterFilters)
  const { keyword, filter: rosterFilter, created_by_me: createdByMe, tag_ids: urlTagIds } = filters
  const searchRef = useRef<HTMLInputElement>(null)
  const tagCatalog = useQuery(
    consoleQuery.tags.get.queryOptions({
      input: { query: { type: 'agent' } },
      enabled: urlTagIds.length > 0,
      refetchOnMount: 'always',
    }),
  )
  const tagIds = useMemo(() => {
    if (!urlTagIds.length || !tagCatalog.isSuccess || tagCatalog.isFetching) return urlTagIds
    const availableIds = new Set(tagCatalog.data.map((tag) => tag.id))
    return urlTagIds.filter((id) => availableIds.has(id))
  }, [urlTagIds, tagCatalog.data, tagCatalog.isSuccess, tagCatalog.isFetching])
  useEffect(() => {
    if (tagIds.length === urlTagIds.length) return
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Keep the external URL in sync with the loaded tag catalog.
    void setFilters({ tag_ids: tagIds })
  }, [tagIds, urlTagIds, setFilters])
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const [tagManagementOpen, setTagManagementOpen] = useState(false)
  const [sortBy] = useQueryState(rosterQueryParamNames.sortBy, rosterSortByQueryParser)
  const trimmedKeyword = keyword.trim()
  const delayedKeyword = useDebounce(trimmedKeyword, { wait: 300 })
  const debouncedKeyword = trimmedKeyword ? delayedKeyword : ''
  const firstUnfilteredPage = { page: 1, limit: ROSTER_PAGE_SIZE, sort_by: sortBy }
  const rosterQueryInput = (page: number, selectedTagIds: string[]) => ({
    query: {
      ...firstUnfilteredPage,
      page,
      ...(debouncedKeyword ? { name: debouncedKeyword } : {}),
      ...(selectedTagIds.length ? { tag_ids: selectedTagIds } : {}),
      ...(createdByMe ? { is_created_by_me: true } : {}),
      ...(rosterFilter !== 'all' ? { publication_status: rosterFilter } : {}),
    },
  })
  const resetRosterPagination = (input: ReturnType<typeof rosterQueryInput>) => {
    queryClient.removeQueries({
      queryKey: consoleQuery.agent.get.key({ type: 'infinite', input }),
      exact: true,
      type: 'inactive',
    })
    scrollViewportRef.current?.scrollTo({ top: 0 })
  }

  const {
    data: rosterPages,
    isPending,
    isFetching,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    hasNextPage,
    isLoadingError,
    isRefetchError,
    refetch,
  } = useInfiniteQuery({
    ...consoleQuery.agent.get.infiniteOptions({
      input: (pageParam) => rosterQueryInput(Number(pageParam), tagIds),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
    placeholderData: keepPreviousData,
  })

  const rosterItems = rosterPages?.pages.flatMap((page) => page.data) ?? []
  const publicationCounts = rosterPages?.pages[0]?.publication_counts ?? EMPTY_PUBLICATION_COUNTS
  const pageTitle = t(($) => $['roster.title'], { ns: 'agentRoster' })
  const pageTitleId = useId()
  const listState: AgentRosterListState = isLoadingError
    ? { status: 'error', onRetry: () => void refetch() }
    : isPending
      ? { status: 'pending' }
      : {
          status: 'ready',
          agents: rosterItems,
          emptyState:
            debouncedKeyword || rosterFilter !== 'all' || createdByMe || tagIds.length
              ? {
                  type: 'filtered',
                  onClearFilters: () => {
                    resetRosterPagination({ query: firstUnfilteredPage })
                    void setFilters(null)
                    searchRef.current?.focus()
                  },
                }
              : 'roster',
          footer: isFetchNextPageError
            ? { status: 'error', onRetry: () => void fetchNextPage() }
            : isRefetchError
              ? { status: 'error', onRetry: () => void refetch() }
              : hasNextPage
                ? {
                    status: 'load-more',
                    isLoading: isFetchingNextPage,
                    onLoadMore: () => void fetchNextPage(),
                  }
                : { status: 'none' },
          isFetching,
        }
  useDocumentTitle(pageTitle)
  const openTagManagement = () => setTagManagementOpen(true)

  return (
    <div
      ref={scrollViewportRef}
      className="flex h-0 min-w-0 grow flex-col overflow-x-hidden overflow-y-auto overscroll-contain bg-background-body"
    >
      <div className="sticky top-0 z-10 shrink-0 bg-background-body px-2 pt-4 pb-2 sm:px-8">
        <div className="flex h-6 min-w-0 items-center justify-between gap-2 sm:gap-4">
          <h1
            id={pageTitleId}
            className="min-w-0 flex-1 truncate text-[18px]/[21.6px] font-semibold text-text-primary"
            title={pageTitle}
          >
            {pageTitle}
          </h1>
          <a
            href={docLink('/use-dify/build/new-agent/overview')}
            target="_blank"
            rel="noreferrer"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md system-xs-regular text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden sm:size-auto sm:gap-0.5"
          >
            <span className="sr-only sm:not-sr-only">
              {t(($) => $['roster.learnMore'], { ns: 'agentRoster' })}
            </span>
            <span aria-hidden className="i-ri-book-open-line size-4 sm:hidden" />
            <span
              aria-hidden
              className="i-ri-external-link-line hidden size-3 sm:inline-block [&:dir(rtl)]:-scale-x-100"
            />
          </a>
        </div>
        <div className="mt-3.5">
          <RosterToolbar
            searchRef={searchRef}
            publicationCounts={publicationCounts}
            tagIds={tagIds}
            onTagIdsChange={(nextIds) => {
              resetRosterPagination(rosterQueryInput(1, nextIds))
              void setFilters({ tag_ids: nextIds })
            }}
            onOpenTagManagement={openTagManagement}
          />
        </div>
      </div>

      <AgentRosterList
        aria-labelledby={pageTitleId}
        state={listState}
        onOpenTagManagement={openTagManagement}
      />
      <TagManagementDialog
        type="agent"
        show={tagManagementOpen}
        onClose={() => setTagManagementOpen(false)}
      />
    </div>
  )
}
