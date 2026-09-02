'use client'

import type { AgentPublicationCountsResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentRosterListState } from './components/agent-roster-list'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useQueryState } from 'nuqs'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/client'
import { AgentRosterList } from './components/agent-roster-list'
import { RosterToolbar } from './components/roster-toolbar'
import {
  rosterCreatedByMeQueryParser,
  rosterFilterQueryParser,
  rosterKeywordQueryParser,
  rosterQueryParamNames,
  rosterSortByQueryParser,
} from './query-params'

const ROSTER_PAGE_SIZE = 30
const EMPTY_PUBLICATION_COUNTS: AgentPublicationCountsResponse = {
  drafts: 0,
  published: 0,
}

export default function RosterPage() {
  const { t } = useTranslation('agentV2')
  const docLink = useDocLink()
  const [keyword] = useQueryState(rosterQueryParamNames.keyword, rosterKeywordQueryParser)
  const [rosterFilter] = useQueryState(rosterQueryParamNames.filter, rosterFilterQueryParser)
  const [createdByMe] = useQueryState(
    rosterQueryParamNames.createdByMe,
    rosterCreatedByMeQueryParser,
  )
  const [sortBy] = useQueryState(rosterQueryParamNames.sortBy, rosterSortByQueryParser)
  const debouncedKeyword = useDebounce(keyword.trim(), { wait: 300 })
  const rosterQueryInput = {
    limit: ROSTER_PAGE_SIZE,
    sort_by: sortBy,
    ...(debouncedKeyword ? { name: debouncedKeyword } : {}),
    ...(createdByMe ? { is_created_by_me: true } : {}),
    ...(rosterFilter !== 'all' ? { publication_status: rosterFilter } : {}),
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
      input: (pageParam) => ({
        query: {
          ...rosterQueryInput,
          page: Number(pageParam),
        },
      }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
    placeholderData: keepPreviousData,
  })

  const rosterItems = rosterPages?.pages.flatMap((page) => page.data) ?? []
  const publicationCounts = rosterPages?.pages[0]?.publication_counts ?? EMPTY_PUBLICATION_COUNTS
  const pageTitle = t(($) => $['roster.title'])
  const pageTitleId = useId()
  const listState: AgentRosterListState = isLoadingError
    ? { status: 'error', onRetry: () => void refetch() }
    : isPending
      ? { status: 'pending' }
      : {
          status: 'ready',
          agents: rosterItems,
          emptyState:
            debouncedKeyword || rosterFilter !== 'all' || createdByMe ? 'filtered' : 'roster',
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

  return (
    <div className="flex h-0 min-w-0 grow flex-col overflow-hidden bg-background-body">
      <div className="shrink-0 bg-background-body px-8 pt-4 pb-2">
        <div className="flex h-6 min-w-0 items-center justify-between gap-4">
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
            className="hidden shrink-0 items-center gap-0.5 rounded-md system-xs-regular text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden sm:inline-flex"
          >
            {t(($) => $['roster.learnMore'])}
            <span aria-hidden className="i-ri-external-link-line size-3" />
          </a>
        </div>
        <div className="mt-3.5">
          <RosterToolbar publicationCounts={publicationCounts} />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ScrollArea className="h-full min-h-0 min-w-0 overflow-hidden">
          <ScrollAreaViewport
            role="region"
            aria-labelledby={pageTitleId}
            className="overscroll-contain"
            style={{ overflowX: 'hidden' }}
          >
            <ScrollAreaContent
              className="min-h-full w-full max-w-full px-8 pt-2 pb-8"
              style={{ minWidth: 0 }}
            >
              <AgentRosterList label={t(($) => $['roster.listLabel'])} state={listState} />
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollArea>
      </div>
    </div>
  )
}
