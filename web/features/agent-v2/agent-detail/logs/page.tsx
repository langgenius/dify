'use client'

import type { AgentLogConversationItemResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentLogsSort } from './components/logs-table'
import type { SourceFilterValue } from './components/source-picker'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import {
  PaginationContent,
  PaginationNavigation,
  PaginationNext,
  PaginationPageJump,
  PaginationPageList,
  PaginationPageSize,
  PaginationPrevious,
  PaginationRoot,
} from '@langgenius/dify-ui/pagination'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Chip from '@/app/components/base/chip'
import { SearchInput } from '@/app/components/base/search-input'
import Sort from '@/app/components/base/sort'
import { useDocLink } from '@/context/i18n'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { consoleQuery } from '@/service/console'
import { AgentDetailSectionSurface } from '../section-surface'
import { AgentLogDetailPanel } from './components/log-detail-panel'
import { AgentLogsTable } from './components/logs-table'
import { AgentLogSourcePicker } from './components/source-picker'

type PeriodKey = 'last7days' | 'last30days' | 'allTime'

type AgentLogsPageProps = {
  agentId: string
}

const queryDateFormat = 'YYYY-MM-DD HH:mm'

const periodOptions: Array<{
  value: PeriodKey
  labelKey:
    | 'agentDetail.logs.filters.period.last7days'
    | 'agentDetail.logs.filters.period.last30days'
    | 'agentDetail.logs.filters.period.allTime'
}> = [
  { value: 'last7days', labelKey: 'agentDetail.logs.filters.period.last7days' },
  { value: 'last30days', labelKey: 'agentDetail.logs.filters.period.last30days' },
  { value: 'allTime', labelKey: 'agentDetail.logs.filters.period.allTime' },
]

const getPeriodQuery = (period: PeriodKey) => {
  if (period === 'allTime') return {}

  const days = period === 'last7days' ? 7 : 30
  return {
    start: dayjs().subtract(days, 'day').format(queryDateFormat),
    end: dayjs().add(1, 'minute').format(queryDateFormat),
  }
}

const parseSortValue = (value: string): AgentLogsSort => {
  const isDescending = value.startsWith('-')
  const field = isDescending ? value.slice(1) : value

  return {
    field: field === 'updated_at' ? 'updated_at' : 'created_at',
    order: isDescending ? 'desc' : 'asc',
  }
}

export function AgentLogsPage({ agentId }: AgentLogsPageProps) {
  const { t } = useTranslation(['agentV2'])
  const { t: tCommon } = useTranslation(['common'])
  const docLink = useDocLink()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [period, setPeriod] = useState<PeriodKey>('last7days')
  const [source, setSource] = useState<SourceFilterValue>([])
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<AgentLogsSort>({
    field: 'created_at',
    order: 'desc',
  })
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [selectedLog, setSelectedLog] = useState<AgentLogConversationItemResponse>()
  const periodItems = periodOptions.map((option) => ({
    value: option.value,
    name: t(($) => $[option.labelKey]),
  }))
  const logSourcesQuery = useQuery(
    consoleQuery.agent.byAgentId.logSources.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
      },
    }),
  )
  const logsQuery = useQuery({
    ...consoleQuery.agent.byAgentId.logs.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
        query: {
          ...getPeriodQuery(period),
          page,
          limit,
          keyword: keyword.trim() || undefined,
          ...(source.length > 0 ? { sources: source } : {}),
          sort_by: sort.field,
          sort_order: sort.order,
        },
      },
    }),
    placeholderData: keepPreviousData,
  })
  const logs = logsQuery.data?.data ?? []
  const totalPages = Math.max(Math.ceil((logsQuery.data?.total ?? 0) / limit), 1)
  const currentPage = logsQuery.data?.page ?? page
  const closeLogDetail = () => {
    setSelectedLog(undefined)
    void logsQuery.refetch()
  }

  return (
    <AgentDetailSectionSurface
      label={t(($) => $['agentDetail.sections.logs'])}
      panelClassName="max-lg:overflow-y-auto"
    >
      <header className="h-auto shrink-0 px-3 pt-3 pb-2 lg:h-26.5 lg:px-6">
        <div className="min-w-0">
          <h2 className="system-xl-semibold text-text-primary">
            {t(($) => $['agentDetail.logs.title'])}
          </h2>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-0.5 system-xs-regular text-text-tertiary">
            <span>{t(($) => $['agentDetail.logs.description'])}</span>
            <a
              href={docLink('/use-dify/monitor/logs')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              {t(($) => $['agentDetail.logs.learnMore'])}
              <span aria-hidden className="i-ri-external-link-line size-3" />
            </a>
          </p>
        </div>

        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
          <Chip
            value={period}
            items={periodItems}
            leftIcon={
              <span aria-hidden className="i-ri-calendar-line block size-4 text-text-secondary" />
            }
            className="min-w-32"
            onSelect={(item) => {
              setPage(1)
              setPeriod(item.value)
            }}
            onClear={() => {
              setPage(1)
              setPeriod('allTime')
            }}
          />

          <AgentLogSourcePicker
            value={source}
            groups={logSourcesQuery.data?.groups ?? []}
            isLoading={logSourcesQuery.isPending}
            isError={logSourcesQuery.isError}
            onRetry={() => {
              void logSourcesQuery.refetch()
            }}
            onChange={(nextSource) => {
              setPage(1)
              setSource(nextSource)
            }}
          />

          <SearchInput
            aria-label={t(($) => $['agentDetail.logs.filters.search.label'])}
            value={keyword}
            placeholder={t(($) => $['agentDetail.logs.filters.search.placeholder'])}
            className="w-full min-w-0 sm:w-50"
            onValueChange={(nextKeyword) => {
              setPage(1)
              setKeyword(nextKeyword)
            }}
          />

          <div className="ml-auto max-w-full">
            <Sort
              order={sort.order === 'desc' ? '-' : ''}
              value={sort.field}
              items={[
                {
                  value: 'created_at',
                  name: t(($) => $['agentDetail.logs.filters.sort.lastCreatedTime']),
                },
                {
                  value: 'updated_at',
                  name: t(($) => $['agentDetail.logs.filters.sort.lastUpdatedTime']),
                },
              ]}
              onSelect={(nextSortValue) => {
                setPage(1)
                setSort(parseSortValue(nextSortValue))
              }}
            />
          </div>
        </div>
      </header>

      <div className="min-h-40 flex-1 px-3 pt-2 pb-3 lg:min-h-0 lg:px-6">
        <AgentLogsTable
          logs={logs}
          isPending={logsQuery.isPending}
          isError={logsQuery.isError}
          isSuccess={logsQuery.isSuccess}
          selectedLogId={selectedLog?.id}
          sort={sort}
          onOpenLog={setSelectedLog}
          onRetry={() => {
            void logsQuery.refetch()
          }}
        />
      </div>

      <Drawer
        open={!!selectedLog}
        modal
        swipeDirection="right"
        onOpenChange={(open) => {
          if (!open) closeLogDetail()
        }}
      >
        <DrawerPortal>
          <DrawerBackdrop className={!isMobile ? 'bg-transparent' : undefined} />
          <DrawerViewport>
            <DrawerPopup className="p-0! data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-3 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-150 data-[swipe-direction=right]:rounded-xl data-[swipe-direction=right]:border data-[swipe-direction=right]:border-components-panel-border">
              <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                <AgentLogDetailPanel agentId={agentId} log={selectedLog} onClose={closeLogDetail} />
              </DrawerContent>
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>

      <PaginationRoot
        page={currentPage}
        totalPages={totalPages}
        onPageChange={setPage}
        className="h-auto shrink-0 px-3 py-3 lg:h-14 lg:px-6"
      >
        <PaginationContent className="max-lg:grid-cols-1 max-lg:justify-items-start">
          <PaginationNavigation>
            <PaginationPrevious aria-label={tCommon(($) => $['pagination.previous'])} />
            <PaginationPageJump
              aria-label={tCommon(($) => $['pagination.editPageNumber'], {
                page: currentPage,
                totalPages,
              })}
              inputLabel={tCommon(($) => $['pagination.pageNumber'])}
            />
            <PaginationNext aria-label={tCommon(($) => $['pagination.next'])} />
          </PaginationNavigation>
          <PaginationPageList className="max-lg:hidden" />
          <PaginationPageSize
            value={limit}
            options={[10, 25, 50]}
            onValueChange={(nextLimit) => {
              setPage(1)
              setLimit(nextLimit)
            }}
            label={tCommon(($) => $['pagination.perPage'])}
            aria-label={tCommon(($) => $['pagination.perPage'])}
            className="max-lg:col-start-1 max-lg:justify-self-start"
          />
        </PaginationContent>
      </PaginationRoot>
    </AgentDetailSectionSurface>
  )
}
