'use client'

import type { SourceFilterValue } from './components/source-picker'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Chip from '@/app/components/base/chip'
import { SearchInput } from '@/app/components/base/search-input'
import Sort from '@/app/components/base/sort'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/client'
import { AgentLogsTable } from './components/logs-table'
import { AgentLogSourcePicker } from './components/source-picker'

type PeriodKey = 'last7days' | 'last30days' | 'allTime'

type AgentLogsPageProps = {
  agentId: string
}

const queryDateFormat = 'YYYY-MM-DD HH:mm'

const periodOptions: Array<{
  value: PeriodKey
  labelKey: 'agentDetail.logs.filters.period.last7days' | 'agentDetail.logs.filters.period.last30days' | 'agentDetail.logs.filters.period.allTime'
}> = [
  { value: 'last7days', labelKey: 'agentDetail.logs.filters.period.last7days' },
  { value: 'last30days', labelKey: 'agentDetail.logs.filters.period.last30days' },
  { value: 'allTime', labelKey: 'agentDetail.logs.filters.period.allTime' },
]

const getPeriodQuery = (period: PeriodKey) => {
  if (period === 'allTime')
    return {}

  const days = period === 'last7days' ? 7 : 30
  return {
    start: dayjs().subtract(days, 'day').format(queryDateFormat),
    end: dayjs().add(1, 'minute').format(queryDateFormat),
  }
}

export function AgentLogsPage({
  agentId,
}: AgentLogsPageProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const docLink = useDocLink()
  const [period, setPeriod] = useState<PeriodKey>('last7days')
  const [source, setSource] = useState<SourceFilterValue>([])
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const periodItems = periodOptions.map(option => ({
    value: option.value,
    name: t(option.labelKey),
  }))
  const logSourcesQuery = useQuery(consoleQuery.agent.byAgentId.logSources.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const logsQuery = useQuery(consoleQuery.agent.byAgentId.logs.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
      query: {
        ...getPeriodQuery(period),
        page,
        limit,
        keyword: keyword.trim() || undefined,
        // TODO: Send multiple source ids after the backend contract supports multi-source filtering.
        source: source.length === 1 ? source[0] : undefined,
      },
    },
  }))
  const logs = logsQuery.data?.data ?? []
  const totalPages = Math.max(Math.ceil((logsQuery.data?.total ?? 0) / limit), 1)
  const currentPage = logsQuery.data?.page ?? page

  return (
    <section
      aria-label={t('agentDetail.sections.logs')}
      className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-components-panel-bg-blur"
    >
      <header className="h-26.5 shrink-0 px-6 pt-3 pb-2">
        <div className="min-w-0">
          <h2 className="system-xl-semibold text-text-primary">
            {t('agentDetail.logs.title')}
          </h2>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-0.5 system-xs-regular text-text-tertiary">
            <span>{t('agentDetail.logs.description')}</span>
            <a
              href={docLink('/use-dify/monitor/logs')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              {t('agentDetail.logs.learnMore')}
              <span aria-hidden className="i-ri-external-link-line size-3" />
            </a>
          </p>
        </div>

        <div className="mt-3 flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Chip
              value={period}
              items={periodItems}
              leftIcon={<span aria-hidden className="i-ri-calendar-line block size-4 text-text-secondary" />}
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
              aria-label={t('agentDetail.logs.filters.search.label')}
              value={keyword}
              placeholder={t('agentDetail.logs.filters.search.placeholder')}
              className="w-50 shrink-0"
              onValueChange={(nextKeyword) => {
                setPage(1)
                setKeyword(nextKeyword)
              }}
            />
          </div>

          <Sort
            order="desc"
            value="updated_at"
            items={[
              { value: 'created_at', name: t('agentDetail.logs.filters.sort.lastCreatedTime') },
              { value: 'updated_at', name: t('agentDetail.logs.filters.sort.lastUpdatedTime') },
            ]}
            onSelect={() => {}}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 px-6 pt-2 pb-3">
        <AgentLogsTable
          logs={logs}
          isPending={logsQuery.isPending}
          isError={logsQuery.isError}
          isSuccess={logsQuery.isSuccess}
          onRetry={() => {
            void logsQuery.refetch()
          }}
        />
      </div>

      <Pagination
        page={currentPage}
        totalPages={totalPages}
        onPageChange={setPage}
        className="h-14 shrink-0 px-6 py-3"
        labels={{
          previous: tCommon('pagination.previous'),
          next: tCommon('pagination.next'),
          editPageNumber: (page, totalPages) => tCommon('pagination.editPageNumber', { page, totalPages }),
          pageNumberInput: tCommon('pagination.pageNumber'),
        }}
        pageSize={{
          value: limit,
          options: [10, 25, 50],
          onValueChange: (nextLimit) => {
            setPage(1)
            setLimit(nextLimit)
          },
          label: tCommon('pagination.perPage'),
          ariaLabel: tCommon('pagination.perPage'),
        }}
      />
    </section>
  )
}
