'use client'

import type { TdHTMLAttributes, ThHTMLAttributes } from 'react'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { cn } from '@langgenius/dify-ui/cn'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import Sort from '@/app/components/base/sort'
import { useDocLink } from '@/context/i18n'

type PeriodKey = 'last7days' | 'last30days' | 'allTime'
type SourceKey = 'all' | 'webapp' | 'workflow'

type FilterOption<T extends string> = {
  value: T
  labelKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.logs.'>
}

type AgentLogRow = {
  id: string
  title: string
  endUser: string
  messageCount: number
  userRate: string
  operationRate: string
  updatedTime: string
  createdTime: string
  source: Exclude<SourceKey, 'all'>
  unread?: boolean
}

const periodOptions: Array<FilterOption<PeriodKey>> = [
  { value: 'last7days', labelKey: 'agentDetail.logs.filters.period.last7days' },
  { value: 'last30days', labelKey: 'agentDetail.logs.filters.period.last30days' },
  { value: 'allTime', labelKey: 'agentDetail.logs.filters.period.allTime' },
]

const sourceOptions: Array<FilterOption<SourceKey>> = [
  { value: 'all', labelKey: 'agentDetail.logs.filters.source.all' },
  { value: 'webapp', labelKey: 'agentDetail.logs.filters.source.webapp' },
  { value: 'workflow', labelKey: 'agentDetail.logs.filters.source.workflow' },
]

const logRows: AgentLogRow[] = [
  {
    id: 'log_001',
    title: 'Asking about Dify agent orchestration best practices',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_002',
    title: 'Alice, our user, talks about prompt orchestration techniques',
    endUser: 'N/A',
    messageCount: 3,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_003',
    title: 'How to self-host a Dify chatbot for an internal team',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 5,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_004',
    title: 'Requesting information about dataset retrieval settings',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 1,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_005',
    title: 'Exploring options for connecting external knowledge bases',
    endUser: 'N/A',
    messageCount: 3,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_006',
    title: 'What types of plugin tools can be used in workflows?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_007',
    title: 'Querying about Dify cloud deployment requirements',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_008',
    title: 'Seeking assistance with YAML file setup',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_009',
    title: 'Inquiring about compatibility with external APIs',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 5,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_010',
    title: 'Can Dify integrate with my existing CRM?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_011',
    title: 'Exploring options for customizing chatbot responses',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_012',
    title: 'Understanding data management and security in Dify',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_013',
    title: 'Learning about available resources for getting started with Dify',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_014',
    title: 'What are the best practices for optimizing prompts?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_015',
    title: 'How do I monitor the performance of my AI applications?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_016',
    title: 'Is there a free trial available for Dify?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_017',
    title: 'How can I improve user satisfaction metrics with Dify?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_018',
    title: 'Are there any upcoming features or improvements in Dify?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_019',
    title: 'What are the recommended steps to deploy a Dify chatbot?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
]

function getOption<T extends string>(options: Array<FilterOption<T>>, value: T) {
  return options.find(option => option.value === value) ?? options[0]!
}

export function AgentLogsPage() {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const docLink = useDocLink()
  const [period, setPeriod] = useState<PeriodKey>('last7days')
  const [source, setSource] = useState<SourceKey>('all')
  const [keyword, setKeyword] = useState('')
  const [sortBy, setSortBy] = useState('-created_at')
  const [page, setPage] = useState(2)
  const [limit, setLimit] = useState(25)

  const selectedPeriod = getOption(periodOptions, period)
  const selectedSource = getOption(sourceOptions, source)
  const sortOrder = sortBy.startsWith('-') ? '-' : ''
  const sortValue = sortBy.replace('-', '') || 'created_at'
  const normalizedKeyword = keyword.trim().toLowerCase()
  const filteredRows = logRows.filter((log) => {
    const matchesSource = source === 'all' || log.source === source
    const matchesKeyword = !normalizedKeyword || [
      log.title,
      log.endUser,
      String(log.messageCount),
      log.updatedTime,
      log.createdTime,
    ].some(value => value.toLowerCase().includes(normalizedKeyword))

    return matchesSource && matchesKeyword
  })

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
            <Select
              value={period}
              onValueChange={(nextValue) => {
                if (nextValue)
                  setPeriod(nextValue as PeriodKey)
              }}
            >
              <SelectTrigger
                aria-label={t('agentDetail.logs.filters.period.label')}
                className="mt-0 w-fit max-w-full min-w-32"
              >
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <span aria-hidden className="i-ri-calendar-line size-4 shrink-0 text-text-tertiary" />
                  <span className="truncate">{t(selectedPeriod.labelKey)}</span>
                </span>
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

            <Select
              value={source}
              onValueChange={(nextValue) => {
                if (nextValue)
                  setSource(nextValue as SourceKey)
              }}
            >
              <SelectTrigger
                aria-label={t('agentDetail.logs.filters.source.label')}
                className="mt-0 w-fit max-w-full min-w-22"
              >
                {t(selectedSource.labelKey)}
              </SelectTrigger>
              <SelectContent popupClassName="w-80">
                {sourceOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    <SelectItemText>{t(option.labelKey)}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <SearchInput
              aria-label={t('agentDetail.logs.filters.search.label')}
              value={keyword}
              placeholder={t('agentDetail.logs.filters.search.placeholder')}
              className="w-50 shrink-0"
              onValueChange={setKeyword}
            />
          </div>

          <Sort
            order={sortOrder}
            value={sortValue}
            items={[
              { value: 'created_at', name: t('agentDetail.logs.filters.sort.lastCreatedTime') },
              { value: 'updated_at', name: t('agentDetail.logs.filters.sort.lastUpdatedTime') },
            ]}
            onSelect={(value) => {
              setSortBy(value)
            }}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 pt-2 pb-3">
        <div className="min-w-[1212px]">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col className="w-5" />
              <col className="w-[42%]" />
              <col className="w-[14%]" />
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-18" />
              <col className="w-34" />
              <col className="w-34" />
            </colgroup>
            <thead>
              <tr className="h-7 bg-background-section-burn text-left system-xs-medium-uppercase text-text-tertiary">
                <th scope="col" className="rounded-l-lg px-0">
                  <span className="sr-only">{t('agentDetail.logs.table.unread')}</span>
                </th>
                <TableHead>{t('agentDetail.logs.table.title')}</TableHead>
                <TableHead>{t('agentDetail.logs.table.endUser')}</TableHead>
                <TableHead>{t('agentDetail.logs.table.messageCount')}</TableHead>
                <TableHead>{t('agentDetail.logs.table.userRate')}</TableHead>
                <TableHead>{t('agentDetail.logs.table.operationRate')}</TableHead>
                <TableHead>{t('agentDetail.logs.table.updatedTime')}</TableHead>
                <TableHead className="rounded-r-lg">{t('agentDetail.logs.table.createdTime')}</TableHead>
              </tr>
            </thead>
            <tbody className="system-sm-regular text-text-secondary">
              {filteredRows.map(log => (
                <tr
                  key={log.id}
                  className="h-10 border-b border-divider-subtle hover:bg-background-default-hover"
                >
                  <td className="px-0">
                    <span className={cn(
                      'mx-auto block size-1.5 rounded-full',
                      log.unread ? 'bg-util-colors-blue-blue-500' : 'bg-transparent',
                    )}
                    />
                  </td>
                  <TableCell className="system-sm-medium text-text-secondary">
                    {log.title}
                  </TableCell>
                  <TableCell translate="no">
                    {log.endUser}
                  </TableCell>
                  <TableCell>
                    {log.messageCount}
                  </TableCell>
                  <TableCell className="text-text-quaternary">
                    {log.userRate}
                  </TableCell>
                  <TableCell className="text-text-quaternary">
                    {log.operationRate}
                  </TableCell>
                  <TableCell>
                    {log.updatedTime}
                  </TableCell>
                  <TableCell>
                    {log.createdTime}
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={page}
        totalPages={200}
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
          onValueChange: setLimit,
          label: tCommon('pagination.perPage'),
          ariaLabel: tCommon('pagination.perPage'),
        }}
      />
    </section>
  )
}

function TableHead({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('px-3 text-left whitespace-nowrap', className)}
      {...props}
    />
  )
}

function TableCell({
  children,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('min-w-0 px-3 whitespace-nowrap', className)}
      {...props}
    >
      <div className="truncate">
        {children}
      </div>
    </td>
  )
}
