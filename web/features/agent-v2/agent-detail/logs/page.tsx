'use client'

import type { AgentLogConversationItemResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentLogsSort } from './components/logs-table'
import type { LogIdentity } from '@/features/log-export/log-identity'
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
import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { Sort } from '@/app/components/base/sort'
import { useDocLink } from '@/context/i18n'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { userTimezoneQueryOptions } from '@/features/account-profile/client'
import {
  isLogTimePeriodRestricted,
  useCloudSandboxPlanStatus,
} from '@/features/log-export/cloud-sandbox-retention'
import { LogIdentityField } from '@/features/log-export/log-identity-picker'
import { LogTimeRangePicker } from '@/features/log-export/log-time-range-picker'
import { consoleQuery } from '@/service/console'
import { AgentDetailSectionSurface } from '../section-surface'
import { AgentLogDetailPanel } from './components/log-detail-panel'
import { AgentLogsTable } from './components/logs-table'
import { AgentLogSourcePicker } from './components/source-picker'
import { AgentLogExportDialog } from './log-export-dialog'
import { agentLogPeriods, defaultAgentLogFilters, toAgentLogQuery } from './log-filters'

type AgentLogsPageProps = {
  agentId: string
}

export function AgentLogsPage({ agentId }: AgentLogsPageProps) {
  const { t } = useTranslation(['agentV2'])
  const { t: tCommon } = useTranslation(['common'])
  const docLink = useDocLink()
  const canExportLogs = useAtomValue(isCurrentWorkspaceManagerAtom)
  const { data: timezone } = useQuery(userTimezoneQueryOptions())
  const planState = useCloudSandboxPlanStatus()
  const allowCustom = !isLogTimePeriodRestricted(planState)
  const [filters, setFilters] = useState(defaultAgentLogFilters)
  const effectiveFilters =
    !allowCustom && filters.period === 'custom'
      ? { ...filters, period: defaultAgentLogFilters.period, customRange: undefined }
      : filters
  const [identityOptionsBeforeFilter, setIdentityOptionsBeforeFilter] = useState<LogIdentity[]>([])
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<AgentLogsSort>({
    field: 'created_at',
    order: 'desc',
  })
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [selectedLog, setSelectedLog] = useState<AgentLogConversationItemResponse>()
  const periodItems = agentLogPeriods.map((period) => ({
    value: period,
    label: t(($) => $[`agentDetail.logs.filters.period.${period}`]),
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
      input: timezone
        ? {
            params: {
              agent_id: agentId,
            },
            query: {
              ...toAgentLogQuery(effectiveFilters, timezone),
              page,
              limit,
              keyword: keyword.trim() || undefined,
              sort_by: sort.field,
              sort_order: sort.order,
            },
          }
        : skipToken,
    }),
    placeholderData: keepPreviousData,
  })
  const logs = logsQuery.data?.data ?? []
  const listedIdentities = logs.flatMap(({ end_user_id, account_id }): LogIdentity[] => {
    const identities: LogIdentity[] = []
    if (end_user_id) identities.push({ id: end_user_id, label: end_user_id, source: 'end-user' })
    if (account_id) identities.push({ id: account_id, label: account_id, source: 'account' })
    return identities
  })
  const identityOptions =
    filters.identities.length || (logsQuery.isPlaceholderData && identityOptionsBeforeFilter.length)
      ? identityOptionsBeforeFilter
      : listedIdentities
  const sourcePicker = {
    groups: logSourcesQuery.data?.groups ?? [],
    isLoading: logSourcesQuery.isPending,
    isError: logSourcesQuery.isError,
    onRetry: () => void logSourcesQuery.refetch(),
  }
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
      <header className="shrink-0 px-3 pt-3 pb-2 lg:px-6">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
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
          {canExportLogs && timezone && (
            <AgentLogExportDialog
              key={agentId}
              agentId={agentId}
              currentFilters={effectiveFilters}
              sourcePicker={sourcePicker}
              identityOptions={identityOptions}
              timezone={timezone}
            />
          )}
        </div>

        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
          <LogTimeRangePicker
            value={effectiveFilters}
            options={periodItems}
            timezone={timezone}
            clearedPeriod="allTime"
            allowCustom={allowCustom}
            onChange={({ period, customRange }) => {
              setPage(1)
              setFilters((previous) => ({ ...previous, period, customRange }))
            }}
          />

          <AgentLogSourcePicker
            {...sourcePicker}
            value={filters.sources}
            onChange={(sources) => {
              setPage(1)
              setFilters((previous) => ({ ...previous, sources }))
            }}
          />

          <LogIdentityField
            agentId={agentId}
            options={identityOptions}
            value={filters.identities}
            onChange={(identities) => {
              if (identities.length && !filters.identities.length)
                setIdentityOptionsBeforeFilter(identityOptions)
              setPage(1)
              setFilters((previous) => ({ ...previous, identities }))
            }}
            disabled={false}
            applyOnClose
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

          <div className="ms-auto max-w-full">
            <Sort
              value={sort}
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
              onValueChange={(nextSortValue) => {
                setPage(1)
                setSort(nextSortValue)
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
          <DrawerBackdrop className="sm:bg-transparent" />
          <DrawerViewport>
            <DrawerPopup className="p-0! data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-3 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-150 data-[swipe-direction=right]:rounded-xl data-[swipe-direction=right]:ring-1">
              <DrawerContent>
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
