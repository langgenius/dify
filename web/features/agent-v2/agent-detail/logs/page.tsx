'use client'

import type { TdHTMLAttributes, ThHTMLAttributes } from 'react'
import type {
  PeriodKey,
  SourceKey,
} from './mock-data'
import { cn } from '@langgenius/dify-ui/cn'
import { Pagination } from '@langgenius/dify-ui/pagination'
import {
  ScrollAreaContent,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Chip from '@/app/components/base/chip'
import { SearchInput } from '@/app/components/base/search-input'
import Sort from '@/app/components/base/sort'
import { useDocLink } from '@/context/i18n'
import {
  getAgentLogRowsView,
  getOption,
  getSortParts,
  periodOptions,
  sourceOptions,
} from './mock-data'

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

  const selectedSource = getOption(sourceOptions, source)
  const { sortOrder, sortValue } = getSortParts(sortBy)
  const tableHeaderLabels = {
    unread: t('agentDetail.logs.table.unread'),
    title: t('agentDetail.logs.table.title'),
    endUser: t('agentDetail.logs.table.endUser'),
    messageCount: t('agentDetail.logs.table.messageCount'),
    userRate: t('agentDetail.logs.table.userRate'),
    operationRate: t('agentDetail.logs.table.operationRate'),
    updatedTime: t('agentDetail.logs.table.updatedTime'),
    createdTime: t('agentDetail.logs.table.createdTime'),
  }
  const periodItems = periodOptions.map(option => ({
    value: option.value,
    name: t(option.labelKey),
  }))
  const {
    currentPage,
    totalPages,
    rows,
  } = getAgentLogRowsView({
    period,
    source,
    keyword,
    sortBy,
    page,
    limit,
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

            <Select
              value={source}
              onValueChange={(nextValue) => {
                if (nextValue) {
                  setPage(1)
                  setSource(nextValue as SourceKey)
                }
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
              onValueChange={(nextKeyword) => {
                setPage(1)
                setKeyword(nextKeyword)
              }}
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
              setPage(1)
              setSortBy(value)
            }}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 px-6 pt-2 pb-3">
        <div className="flex h-full min-w-0 flex-col overflow-x-auto">
          <div className="min-w-[1212px] shrink-0">
            <table aria-hidden="true" className="w-full table-fixed border-collapse">
              <LogsTableColGroup />
              <LogsTableHeader labels={tableHeaderLabels} />
            </table>
          </div>

          <ScrollAreaRoot className="relative min-h-0 min-w-[1212px] flex-1 overflow-hidden">
            <ScrollAreaViewport
              aria-label={t('agentDetail.logs.title')}
              role="region"
              tabIndex={-1}
              className="overscroll-contain"
            >
              <ScrollAreaContent>
                <table className="w-full table-fixed border-collapse">
                  <LogsTableColGroup />
                  <LogsTableHeader labels={tableHeaderLabels} rowClassName="sr-only" />
                  <tbody className="system-sm-regular text-text-secondary">
                    {rows.length > 0
                      ? rows.map(log => (
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
                        ))
                      : (
                          <tr className="h-20 border-b border-divider-subtle">
                            <td colSpan={8} className="px-3 text-center text-text-tertiary">
                              {t('agentDetail.logs.empty')}
                            </td>
                          </tr>
                        )}
                  </tbody>
                </table>
              </ScrollAreaContent>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar className="data-[orientation=vertical]:translate-x-1">
              <ScrollAreaThumb />
            </ScrollAreaScrollbar>
          </ScrollAreaRoot>
        </div>
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

type LogsTableHeaderLabels = {
  unread: string
  title: string
  endUser: string
  messageCount: string
  userRate: string
  operationRate: string
  updatedTime: string
  createdTime: string
}

function LogsTableHeader({
  labels,
  rowClassName,
}: {
  labels: LogsTableHeaderLabels
  rowClassName?: string
}) {
  return (
    <thead>
      <tr className={cn('h-7 bg-background-section-burn text-left system-xs-medium-uppercase text-text-tertiary', rowClassName)}>
        <th scope="col" className="rounded-l-lg px-0">
          <span className="sr-only">{labels.unread}</span>
        </th>
        <TableHead>{labels.title}</TableHead>
        <TableHead>{labels.endUser}</TableHead>
        <TableHead>{labels.messageCount}</TableHead>
        <TableHead>{labels.userRate}</TableHead>
        <TableHead>{labels.operationRate}</TableHead>
        <TableHead>{labels.updatedTime}</TableHead>
        <TableHead className="rounded-r-lg">{labels.createdTime}</TableHead>
      </tr>
    </thead>
  )
}

function LogsTableColGroup() {
  return (
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
