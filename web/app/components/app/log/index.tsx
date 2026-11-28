'use client'

import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import type { QueryParam } from './log-filters'
import type { LogIdentity } from '@/features/log-export/log-identity'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import { useAtomValue } from 'jotai'
import { parseAsInteger, useQueryState } from 'nuqs'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { APP_PAGE_LIMIT } from '@/config'
import { useDocLink } from '@/context/i18n'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { userTimezoneQueryOptions } from '@/features/account-profile/client'
import {
  resolveLogTimePeriod,
  useCloudSandboxPlanStatus,
} from '@/features/log-export/cloud-sandbox-retention'
import { consoleQuery } from '@/service/console'
import PageTitle from '../log-annotation/page-title'
import { ConversationLogExportDialog } from './conversation-log-export-dialog'
import Filter from './filter'
import List from './list'
import { getLogIdentities, toLogFilters, useLogFilterOptions } from './log-filters'
import { RetentionUpgradeNotice } from './retention-upgrade-notice'

type ILogsProps = {
  appDetail: AppDetailWithSite
}

const defaultQueryParams: QueryParam = {
  period: '2',
  annotation_status: 'all',
  sort_by: '-created_at',
}

const logsStateCache = new Map<
  string,
  { queryParams: QueryParam; limit: number; identityOptionsBeforeFilter: LogIdentity[] }
>()

const Logs: FC<ILogsProps> = ({ appDetail }) => {
  const { t, ready } = useTranslation(['appLog', 'common'], { useSuspense: false })
  const docLink = useDocLink()
  const [pageParam, setPageParam] = useQueryState('page', parseAsInteger)
  const page = Math.max(pageParam ?? 1, 1)
  const cloudSandboxPlanState = useCloudSandboxPlanStatus()
  const filterOptions = useLogFilterOptions(appDetail.id, cloudSandboxPlanState)
  const { data: timezone } = useQuery(userTimezoneQueryOptions())
  const canExportLogs = useAtomValue(isCurrentWorkspaceManagerAtom)
  const cachedState = logsStateCache.get(appDetail.id)
  const [queryParams, setQueryParams] = useState<QueryParam>(
    cachedState?.queryParams ?? defaultQueryParams,
  )
  const [appliedQueryParams, setAppliedQueryParams] = useState(queryParams)
  const [limit, setLimit] = useState(cachedState?.limit ?? APP_PAGE_LIMIT)
  const [identityOptionsBeforeFilter, setIdentityOptionsBeforeFilter] = useState(
    cachedState?.identityOptionsBeforeFilter ?? [],
  )
  useEffect(() => {
    logsStateCache.set(appDetail.id, { queryParams, limit, identityOptionsBeforeFilter })
  }, [appDetail.id, queryParams, limit, identityOptionsBeforeFilter])

  const { run: applyQueryParams } = useDebounceFn(
    (next: QueryParam) => {
      setAppliedQueryParams(next)
      if (pageParam !== null) void setPageParam(null)
    },
    { wait: 500 },
  )

  const effectiveQueryParams = {
    ...queryParams,
    period: resolveLogTimePeriod(queryParams.period, cloudSandboxPlanState),
  }
  const requestQueryParams = {
    ...appliedQueryParams,
    period: resolveLogTimePeriod(appliedQueryParams.period, cloudSandboxPlanState),
  }
  const isChatMode = appDetail.mode !== 'completion'
  const supportsLogExport =
    !isChatMode ||
    appDetail.mode === 'chat' ||
    appDetail.mode === 'advanced-chat' ||
    appDetail.mode === 'agent-chat'

  const query = timezone
    ? { ...toLogFilters(requestQueryParams, cloudSandboxPlanState, timezone), page, limit }
    : undefined

  // When the details are obtained, proceed to the next request
  const { data: chatConversations, refetch: mutateChatList } = useQuery(
    consoleQuery.apps.byAppId.chatConversations.get.queryOptions({
      input: isChatMode && query ? { params: { app_id: appDetail.id }, query } : skipToken,
    }),
  )

  const { data: completionConversations, refetch: mutateCompletionList } = useQuery(
    consoleQuery.apps.byAppId.completionConversations.get.queryOptions({
      input: !isChatMode && query ? { params: { app_id: appDetail.id }, query } : skipToken,
    }),
  )

  const logs = isChatMode ? chatConversations : completionConversations
  const identityOptions =
    queryParams.identities?.length || requestQueryParams.identities?.length
      ? identityOptionsBeforeFilter
      : getLogIdentities(logs?.data ?? [])
  const total = logs?.total
  const totalPages = total ? Math.max(Math.ceil(total / limit), 1) : 1

  const handleQueryParamsChange = (next: QueryParam) => {
    if (next.identities?.length && !queryParams.identities?.length)
      setIdentityOptionsBeforeFilter(identityOptions)
    setQueryParams(next)
    applyQueryParams(next)
  }

  if (!ready) return null

  return (
    <div className="flex h-full grow flex-col">
      <PageTitle
        title={t(($) => $.title, { ns: 'appLog' })}
        description={t(($) => $.description, { ns: 'appLog' })}
        learnMoreHref={docLink('/use-dify/monitor/logs')}
        learnMoreLabel={t(($) => $['operation.learnMore'], { ns: 'common' })}
      />
      <div className="flex min-h-0 flex-1 grow flex-col py-4">
        <Filter
          isChatMode={isChatMode}
          appId={appDetail.id}
          filterOptions={filterOptions}
          queryParams={effectiveQueryParams}
          timezone={timezone}
          setQueryParams={handleQueryParamsChange}
          identityOptions={supportsLogExport ? identityOptions : undefined}
          actions={
            supportsLogExport &&
            canExportLogs &&
            timezone && (
              <ConversationLogExportDialog
                key={appDetail.id}
                appId={appDetail.id}
                appName={appDetail.name}
                appMode={appDetail.mode}
                currentQueryParams={effectiveQueryParams}
                filterOptions={filterOptions}
                identityOptions={identityOptions}
                planState={cloudSandboxPlanState}
                timezone={timezone}
              />
            )
          }
        />
        <RetentionUpgradeNotice />
        <List
          logs={logs}
          appDetail={appDetail}
          onRefresh={isChatMode ? mutateChatList : mutateCompletionList}
        />
        {/* Show Pagination only if the total is more than the limit */}
        {total !== undefined && total > APP_PAGE_LIMIT ? (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={(nextPage) => void setPageParam(nextPage === 1 ? null : nextPage)}
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
