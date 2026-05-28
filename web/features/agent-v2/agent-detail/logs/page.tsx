'use client'

import type { I18nKeysWithPrefix } from '@/types/i18n'
import { Input } from '@langgenius/dify-ui/input'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type StatusKey = 'all' | 'succeeded' | 'failed' | 'running'
type PeriodKey = 'last7days' | 'last30days' | 'allTime'
type AgentLogStatus = Exclude<StatusKey, 'all'>

type FilterOption<T extends string> = {
  value: T
  labelKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.logs.'>
}

type AgentLogRow = {
  id: string
  startedAt: string
  status: AgentLogStatus
  runtime: string
  tokens: string
  user: string
  triggerKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.logs.triggers.'>
}

const statusOptions: Array<FilterOption<StatusKey>> = [
  { value: 'all', labelKey: 'agentDetail.logs.filters.status.all' },
  { value: 'succeeded', labelKey: 'agentDetail.logs.filters.status.succeeded' },
  { value: 'failed', labelKey: 'agentDetail.logs.filters.status.failed' },
  { value: 'running', labelKey: 'agentDetail.logs.filters.status.running' },
]

const periodOptions: Array<FilterOption<PeriodKey>> = [
  { value: 'last7days', labelKey: 'agentDetail.logs.filters.period.last7days' },
  { value: 'last30days', labelKey: 'agentDetail.logs.filters.period.last30days' },
  { value: 'allTime', labelKey: 'agentDetail.logs.filters.period.allTime' },
]

const logRows: AgentLogRow[] = [
  {
    id: 'run_8f4e21',
    startedAt: '2026-05-27 14:28',
    status: 'succeeded',
    runtime: '2.431s',
    tokens: '1,284',
    user: 'tender-reviewer',
    triggerKey: 'agentDetail.logs.triggers.workflowNode',
  },
  {
    id: 'run_7a19c0',
    startedAt: '2026-05-27 13:46',
    status: 'running',
    runtime: '0.842s',
    tokens: '624',
    user: 'pricing-team',
    triggerKey: 'agentDetail.logs.triggers.debugRun',
  },
  {
    id: 'run_62bd95',
    startedAt: '2026-05-26 18:12',
    status: 'failed',
    runtime: '1.209s',
    tokens: '416',
    user: 'compliance-reviewer',
    triggerKey: 'agentDetail.logs.triggers.workflowNode',
  },
]

const statusTone: Record<AgentLogStatus, 'success' | 'error' | 'normal'> = {
  succeeded: 'success',
  failed: 'error',
  running: 'normal',
}

export function AgentLogsPage() {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [status, setStatus] = useState<StatusKey>('all')
  const [period, setPeriod] = useState<PeriodKey>('last7days')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)

  const selectedStatus = statusOptions.find(option => option.value === status) ?? statusOptions[0]!
  const selectedPeriod = periodOptions.find(option => option.value === period) ?? periodOptions[0]!

  return (
    <section
      aria-label={t('agentDetail.sections.logs')}
      className="h-full min-w-0 flex-1 overflow-auto bg-components-panel-bg-blur px-4 py-6 sm:px-12"
    >
      <div className="mx-auto flex h-full max-w-6xl flex-col">
        <header>
          <h2 className="system-xl-semibold text-text-primary">
            {t('agentDetail.logs.title')}
          </h2>
          <p className="mt-1 system-sm-regular text-text-tertiary">
            {t('agentDetail.logs.description')}
          </p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col py-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onValueChange={(nextValue) => {
                if (nextValue)
                  setStatus(nextValue as StatusKey)
              }}
            >
              <SelectTrigger
                aria-label={t('agentDetail.logs.filters.status.label')}
                className="mt-0 w-fit max-w-full min-w-36"
              >
                {t(selectedStatus.labelKey)}
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    <SelectItemText>{t(option.labelKey)}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={period}
              onValueChange={(nextValue) => {
                if (nextValue)
                  setPeriod(nextValue as PeriodKey)
              }}
            >
              <SelectTrigger
                aria-label={t('agentDetail.logs.filters.period.label')}
                className="mt-0 w-fit max-w-full min-w-36"
              >
                {t(selectedPeriod.labelKey)}
              </SelectTrigger>
              <SelectContent>
                {periodOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    <SelectItemText>{t(option.labelKey)}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative w-62 max-w-full">
              <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary" />
              <Input
                aria-label={t('agentDetail.logs.filters.search.label')}
                name="agent-log-search"
                autoComplete="off"
                value={keyword}
                placeholder={t('agentDetail.logs.filters.search.placeholder')}
                className="pl-9"
                onChange={(event) => {
                  setKeyword(event.target.value)
                }}
              />
            </div>
          </div>

          <div className="min-h-0 overflow-x-auto">
            <table className="mt-2 w-full min-w-180 border-collapse border-0">
              <thead className="system-xs-medium-uppercase text-text-tertiary">
                <tr>
                  <th scope="col" className="rounded-l-lg bg-background-section-burn py-1.5 pr-2 pl-3 text-left whitespace-nowrap">
                    {t('agentDetail.logs.table.startTime')}
                  </th>
                  <th scope="col" className="bg-background-section-burn py-1.5 pr-2 pl-3 text-left whitespace-nowrap">
                    {t('agentDetail.logs.table.status')}
                  </th>
                  <th scope="col" className="bg-background-section-burn py-1.5 pr-2 pl-3 text-left whitespace-nowrap">
                    {t('agentDetail.logs.table.runtime')}
                  </th>
                  <th scope="col" className="bg-background-section-burn py-1.5 pr-2 pl-3 text-left whitespace-nowrap">
                    {t('agentDetail.logs.table.tokens')}
                  </th>
                  <th scope="col" className="bg-background-section-burn py-1.5 pr-2 pl-3 text-left whitespace-nowrap">
                    {t('agentDetail.logs.table.user')}
                  </th>
                  <th scope="col" className="rounded-r-lg bg-background-section-burn py-1.5 pr-2 pl-3 text-left whitespace-nowrap">
                    {t('agentDetail.logs.table.trigger')}
                  </th>
                </tr>
              </thead>
              <tbody className="system-sm-regular text-text-secondary">
                {logRows.map(log => (
                  <tr key={log.id} className="border-b border-divider-subtle hover:bg-background-default-hover">
                    <td className="p-3 pr-2 whitespace-nowrap">
                      <div className="system-sm-medium text-text-secondary">{log.startedAt}</div>
                      <div className="mt-0.5 code-xs-regular text-text-tertiary" translate="no">{log.id}</div>
                    </td>
                    <td className="p-3 pr-2 whitespace-nowrap">
                      <div className="inline-flex items-center gap-1 system-xs-semibold-uppercase">
                        <StatusDot status={statusTone[log.status]} />
                        <span>{t(`agentDetail.logs.filters.status.${log.status}`)}</span>
                      </div>
                    </td>
                    <td className="p-3 pr-2 whitespace-nowrap">{log.runtime}</td>
                    <td className="p-3 pr-2 whitespace-nowrap">{log.tokens}</td>
                    <td className="p-3 pr-2">
                      <div className="max-w-48 truncate">{log.user}</div>
                    </td>
                    <td className="p-3 pr-2">
                      <div className="max-w-48 truncate">{t(log.triggerKey)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            totalPages={3}
            onPageChange={setPage}
            labels={{
              previous: tCommon('pagination.previous'),
              next: tCommon('pagination.next'),
              editPageNumber: (page, totalPages) => tCommon('pagination.editPageNumber', { page, totalPages }),
              pageNumberInput: tCommon('pagination.pageNumber'),
            }}
            pageSize={{
              value: limit,
              options: [10, 25, 50],
              onValueChange: setLimit,
              label: tCommon('pagination.perPage'),
              ariaLabel: tCommon('pagination.perPage'),
            }}
          />
        </div>
      </div>
    </section>
  )
}
