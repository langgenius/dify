'use client'

import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import type { WorkflowLogQuery } from './log-filters'
import type { LogIdentity } from '@/features/log-export/log-identity'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import EmptyElement from '@/app/components/app/log/empty-element'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { APP_PAGE_LIMIT } from '@/config'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { userTimezoneQueryOptions } from '@/features/account-profile/client'
import {
  resolveLogTimePeriod,
  useCloudSandboxPlanStatus,
} from '@/features/log-export/cloud-sandbox-retention'
import { consoleQuery } from '@/service/console'
import PageTitle from '../log-annotation/page-title'
import { ArchivedLogsNotice } from '../log/archived-logs-notice'
import { shouldShowArchivedLogsNotice } from '../log/archived-logs-notice-utils'
import { logDateRange, TIME_PERIOD_MAPPING } from '../log/log-filters'
import { RetentionUpgradeNotice } from '../log/retention-upgrade-notice'
import Filter from './filter'
import List from './list'
import {
  getWorkflowLogIdentities,
  toWorkflowLogFilters,
  useWorkflowLogFilterOptions,
} from './log-filters'
import { WorkflowLogExportDialog } from './workflow-log-export-dialog'

export type ILogsProps = {
  appDetail: AppDetailWithSite
}

const Logs: FC<ILogsProps> = ({ appDetail }) => {
  const { t } = useTranslation(['appLog', 'common'])
  const { data: timezone } = useQuery(userTimezoneQueryOptions())
  const [queryParams, setQueryParams] = useState<WorkflowLogQuery>({ status: 'all', period: '2' })
  const [identityOptionsBeforeFilter, setIdentityOptionsBeforeFilter] = useState<LogIdentity[]>([])
  const [currPage, setCurrPage] = React.useState<number>(0)
  const cloudSandboxPlanState = useCloudSandboxPlanStatus()
  const filterOptions = useWorkflowLogFilterOptions(cloudSandboxPlanState)
  const canExportLogs = useAtomValue(isCurrentWorkspaceManagerAtom)
  const effectivePeriod = resolveLogTimePeriod(queryParams.period, cloudSandboxPlanState)
  const effectiveQueryParams = { ...queryParams, period: effectivePeriod }
  const debouncedQueryParams = useDebounce(queryParams, { wait: 500 })
  const requestQueryParams = {
    ...debouncedQueryParams,
    period: resolveLogTimePeriod(debouncedQueryParams.period, cloudSandboxPlanState),
  }
  const [limit, setLimit] = React.useState<number>(APP_PAGE_LIMIT)

  const query = timezone
    ? {
        page: currPage + 1,
        detail: true,
        limit,
        ...toWorkflowLogFilters(requestQueryParams, cloudSandboxPlanState, timezone),
      }
    : undefined

  const { data: workflowLogs, refetch: mutate } = useQuery(
    consoleQuery.apps.byAppId.workflowAppLogs.get.queryOptions({
      input: query ? { params: { app_id: appDetail.id }, query } : skipToken,
    }),
  )
  const total = workflowLogs?.total
  const identityOptions =
    queryParams.identities?.length || requestQueryParams.identities?.length
      ? identityOptionsBeforeFilter
      : getWorkflowLogIdentities(workflowLogs?.data ?? [])
  const totalPages = total ? Math.max(Math.ceil(total / limit), 1) : 1
  const customStart =
    effectivePeriod === 'custom' && timezone
      ? logDateRange('custom', cloudSandboxPlanState, timezone, queryParams.customRange)?.start
      : undefined
  const archiveCutoff = timezone && logDateRange('4', 'unrestricted', timezone)?.start
  const showArchivedLogsNotice =
    customStart && archiveCutoff
      ? customStart.isBefore(archiveCutoff, 'day')
      : shouldShowArchivedLogsNotice(effectivePeriod, TIME_PERIOD_MAPPING)

  function handleQueryParamsChange(next: WorkflowLogQuery) {
    if (next.identities?.length && !queryParams.identities?.length)
      setIdentityOptionsBeforeFilter(identityOptions)
    setCurrPage(0)
    setQueryParams(next)
  }

  return (
    <div className="flex h-full flex-col">
      <PageTitle
        title={t(($) => $.workflowTitle, { ns: 'appLog' })}
        description={t(($) => $.workflowSubtitle, { ns: 'appLog' })}
      />
      <div className="flex max-h-[calc(100%-16px)] flex-1 flex-col py-4">
        <Filter
          appId={appDetail.id}
          queryParams={effectiveQueryParams}
          setQueryParams={handleQueryParamsChange}
          filterOptions={filterOptions}
          identityOptions={identityOptions}
          timezone={timezone}
          actions={
            canExportLogs &&
            timezone && (
              <WorkflowLogExportDialog
                key={appDetail.id}
                appId={appDetail.id}
                appName={appDetail.name}
                filterOptions={filterOptions}
                currentQueryParams={effectiveQueryParams}
                identityOptions={identityOptions}
                planState={cloudSandboxPlanState}
                timezone={timezone}
              />
            )
          }
        />
        <RetentionUpgradeNotice />
        {showArchivedLogsNotice && <ArchivedLogsNotice />}
        {/* workflow log */}
        {total === undefined ? (
          <LoadingPlaceholder className="h-full" />
        ) : total > 0 ? (
          <List logs={workflowLogs} appDetail={appDetail} onRefresh={mutate} />
        ) : (
          <EmptyElement appDetail={appDetail} />
        )}
        {/* Show Pagination only if the total is more than the limit */}
        {total && total > APP_PAGE_LIMIT ? (
          <Pagination
            page={currPage + 1}
            totalPages={totalPages}
            onPageChange={(page) => setCurrPage(page - 1)}
            labels={{
              previous: t(($) => $['pagination.previous'], { ns: 'common' }),
              next: t(($) => $['pagination.next'], { ns: 'common' }),
              editPageNumber: (page, totalPages) =>
                t(($) => $['pagination.editPageNumber'], { ns: 'common', page, totalPages }),
              pageNumberInput: t(($) => $['pagination.pageNumber'], { ns: 'common' }),
            }}
            pageSize={{
              value: limit,
              options: [10, 25, 50],
              onValueChange: setLimit,
              label: t(($) => $['pagination.perPage'], { ns: 'common' }),
              ariaLabel: t(($) => $['pagination.perPage'], { ns: 'common' }),
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

export default Logs
