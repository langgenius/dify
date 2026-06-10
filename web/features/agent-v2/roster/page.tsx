'use client'

import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { debounce, parseAsString, useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/client'
import { AgentRosterList } from './components/agent-roster-list'
import { RosterToolbar } from './components/roster-toolbar'

const ROSTER_PAGE_SIZE = 30
const isAgentInUse = (agent: { app_id?: string | null, workflow_id?: string | null }) => Boolean(agent.app_id || agent.workflow_id)
const rosterTabClassName = 'pt-0 pb-2 system-xl-semibold data-active:border-util-colors-blue-brand-blue-brand-500 data-disabled:opacity-100'

export default function RosterPage() {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
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
  const inUseAgents = rosterItems.filter(isAgentInUse).length
  const draftAgents = Math.max(rosterItems.length - inUseAgents, 0)

  useDocumentTitle(tCommon('menus.roster'))

  return (
    <main className="flex h-0 min-w-0 grow flex-col overflow-hidden bg-background-body">
      <Tabs defaultValue="agent" className="flex min-h-0 flex-1 flex-col">
        <div className="h-25.5 shrink-0 bg-background-body px-8 pt-4 pb-4">
          <div className="flex min-w-0 items-center justify-between gap-4">
            <TabsList aria-label={t('roster.tabsLabel')}>
              <TabsTab value="agent" className={rosterTabClassName}>
                {t('roster.tabs.agent')}
              </TabsTab>
              <TabsTab value="human" disabled className={rosterTabClassName}>
                {t('roster.tabs.human')}
              </TabsTab>
            </TabsList>
            <a
              href="https://docs.dify.ai/"
              target="_blank"
              rel="noreferrer"
              className="hidden shrink-0 items-center gap-0.5 rounded-md system-xs-regular text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden sm:inline-flex"
            >
              {t('roster.learnMore')}
              <span aria-hidden className="i-ri-external-link-line size-3" />
            </a>
          </div>
          <div className="mt-3.5">
            <RosterToolbar
              draftAgents={draftAgents}
              inUseAgents={inUseAgents}
              keyword={keyword}
              totalAgents={totalAgents}
              onKeywordChange={(value) => {
                void setKeyword(value)
              }}
            />
          </div>
        </div>

        <TabsPanel value="agent" tabIndex={-1} className="min-h-0 flex-1">
          <ScrollAreaRoot className="relative h-full min-h-0 min-w-0 overflow-hidden">
            <ScrollAreaViewport tabIndex={-1} className="overscroll-contain">
              <ScrollAreaContent className="min-h-full px-8 pt-2 pb-8">
                <AgentRosterList
                  agents={rosterItems}
                  hasMore={!!hasNextPage}
                  isEmptySearch={!!debouncedKeyword}
                  isError={!!error}
                  isFetching={isFetching}
                  isFetchingNextPage={isFetchingNextPage}
                  isPending={isPending}
                  label={t('roster.listLabel')}
                  onLoadMore={() => fetchNextPage()}
                />
              </ScrollAreaContent>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar className="data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-1">
              <ScrollAreaThumb />
            </ScrollAreaScrollbar>
          </ScrollAreaRoot>
        </TabsPanel>
      </Tabs>
    </main>
  )
}
