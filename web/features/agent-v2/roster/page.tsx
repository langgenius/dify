'use client'

import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import type { RosterFilterValue } from './components/roster-filter'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
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
const isAgentPublished = (agent: AgentAppPartial) => agent.active_config_is_published === true

const getFilteredRosterItems = (agents: AgentAppPartial[], filter: RosterFilterValue) => {
  if (filter === 'published') return agents.filter(isAgentPublished)

  if (filter === 'drafts') return agents.filter((agent) => !isAgentPublished(agent))

  return agents
}

export default function RosterPage() {
  const { t } = useTranslation('agentV2')
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
  }

  const {
    data: rosterPages,
    isPending,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
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
      placeholderData: keepPreviousData,
    }),
  })

  const rosterItems: AgentAppPartial[] = rosterPages?.pages.flatMap((page) => page.data) ?? []
  const publishedAgents = rosterItems.filter(isAgentPublished).length
  const draftAgents = Math.max(rosterItems.length - publishedAgents, 0)
  const filteredRosterItems = getFilteredRosterItems(rosterItems, rosterFilter)

  useDocumentTitle('Agents')

  return (
    <div className="flex h-0 min-w-0 grow flex-col overflow-hidden bg-background-body">
      <div className="shrink-0 bg-background-body px-8 pt-4 pb-2">
        <div className="flex h-6 min-w-0 items-center justify-between gap-4">
          <h1 className="min-w-0 flex-1 truncate text-[18px]/[21.6px] font-semibold text-text-primary">
            Agents
          </h1>
          <a
            href="https://docs.dify.ai/"
            target="_blank"
            rel="noreferrer"
            className="hidden shrink-0 items-center gap-0.5 rounded-md system-xs-regular text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden sm:inline-flex"
          >
            {t(($) => $['roster.learnMore'])}
            <span aria-hidden className="i-ri-external-link-line size-3" />
          </a>
        </div>
        <div className="mt-3.5">
          <RosterToolbar draftAgents={draftAgents} publishedAgents={publishedAgents} />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ScrollAreaRoot className="relative h-full min-h-0 min-w-0 overflow-hidden">
          <ScrollAreaViewport tabIndex={-1} className="overscroll-contain">
            <ScrollAreaContent className="min-h-full px-8 pt-2 pb-8">
              <AgentRosterList
                agents={filteredRosterItems}
                hasMore={!!hasNextPage}
                isEmptySearch={!!debouncedKeyword || rosterFilter !== 'all'}
                isError={!!error}
                isFetching={isFetching}
                isFetchingNextPage={isFetchingNextPage}
                isPending={isPending}
                label={t(($) => $['roster.listLabel'])}
                onLoadMore={() => fetchNextPage()}
              />
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollAreaRoot>
      </div>
    </div>
  )
}
