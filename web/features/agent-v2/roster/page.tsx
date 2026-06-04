'use client'

import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { debounce, parseAsString, useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/client'
import { AgentRosterList } from './components/agent-roster-list'
import { RosterToolbar } from './components/roster-toolbar'

const ROSTER_PAGE_SIZE = 30

export default function RosterPage() {
  const { t } = useTranslation()
  const { t: tAgentV2 } = useTranslation('agentV2')
  const [keyword, setKeyword] = useQueryState('keyword', parseAsString.withDefault('').withOptions({
    limitUrlUpdates: debounce(300),
  }))
  const debouncedKeyword = useDebounce(keyword.trim(), { wait: 300 })

  const rosterQueryInput = {
    limit: ROSTER_PAGE_SIZE,
    ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
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
    ...consoleQuery.agents.get.infiniteOptions({
      input: pageParam => ({
        query: {
          ...rosterQueryInput,
          page: Number(pageParam),
        },
      }),
      getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
  })

  const rosterItems = rosterPages?.pages.flatMap(page => page.data) ?? []
  const totalAgents = rosterPages?.pages[0]?.total ?? 0

  useDocumentTitle(t('menus.roster', { ns: 'common' }))

  return (
    <main className="flex h-0 min-w-0 grow flex-col overflow-y-auto bg-background-body">
      <div className="sticky top-0 z-10 bg-background-body px-8 pt-4 pb-3">
        <header className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-[18px]/[21.6px] font-semibold text-text-primary">
              {tAgentV2('roster.title')}
            </h1>
            <a
              href="https://docs.dify.ai/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 rounded-md system-xs-semibold text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              {tAgentV2('roster.learnMore')}
              <span aria-hidden className="i-ri-arrow-right-up-line size-3" />
            </a>
          </div>
          <p className="max-w-3xl system-sm-regular text-text-tertiary">
            {tAgentV2('roster.description')}
          </p>
        </header>

        <RosterToolbar
          keyword={keyword}
          totalAgents={totalAgents}
          onKeywordChange={(value) => {
            void setKeyword(value)
          }}
        />
      </div>

      <div className="px-8 pb-8">
        <AgentRosterList
          agents={rosterItems}
          hasMore={!!hasNextPage}
          isEmptySearch={!!debouncedKeyword}
          isError={!!error}
          isFetching={isFetching}
          isFetchingNextPage={isFetchingNextPage}
          isPending={isPending}
          onLoadMore={() => fetchNextPage()}
        />
      </div>
    </main>
  )
}
