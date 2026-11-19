'use client'

import type {
  AppDetailWithSite,
  GetAppsByAppIdChatConversationsData,
} from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { APP_PAGE_LIMIT } from '@/config'
import { useDocLink } from '@/context/i18n'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import PageTitle from '../log-annotation/page-title'
import {
  resolveLogTimePeriod,
  resolveLogTimePeriodOption,
  useCloudSandboxPlanStatus,
} from './cloud-sandbox-retention'
import Filter from './filter'
import List from './list'
import { LogExportDialog } from './log-export-dialog'
import { getLogIdentities, logDateRange, TIME_PERIOD_MAPPING } from './log-filters'
import { RetentionUpgradeNotice } from './retention-upgrade-notice'

type ILogsProps = {
  appDetail: AppDetailWithSite
}

type ConversationsQuery = NonNullable<GetAppsByAppIdChatConversationsData['query']>

export type QueryParam = {
  period: string
  annotation_status?: ConversationsQuery['annotation_status']
  keyword?: string
  sort_by?: ConversationsQuery['sort_by']
}

const defaultQueryParams: QueryParam = {
  period: '2',
  annotation_status: 'all',
  sort_by: '-created_at',
}

const logsStateCache = new Map<string, { queryParams: QueryParam; limit: number }>()

const Logs: FC<ILogsProps> = ({ appDetail }) => {
  const { t, ready } = useTranslation(['appLog', 'common'], { useSuspense: false })
  const docLink = useDocLink()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const pageParam = Number.parseInt(searchParams.get('page') || '1', 10)
  const currPage = Number.isNaN(pageParam) || pageParam < 1 ? 0 : pageParam - 1
  const cloudSandboxPlanState = useCloudSandboxPlanStatus()
  const canExportLogs = useAtomValue(isCurrentWorkspaceManagerAtom)
  const cachedState = logsStateCache.get(appDetail.id)
  const [queryParams, setQueryParams] = useState<QueryParam>(
    cachedState?.queryParams ?? defaultQueryParams,
  )
  const [limit, setLimit] = useState(cachedState?.limit ?? APP_PAGE_LIMIT)
  useEffect(() => {
    logsStateCache.set(appDetail.id, { queryParams, limit })
  }, [appDetail.id, queryParams, limit])
  const effectivePeriod = resolveLogTimePeriod(queryParams.period, cloudSandboxPlanState)
  const effectiveQueryParams = { ...queryParams, period: effectivePeriod }
  const debouncedQueryParams = useDebounce(queryParams, { wait: 500 })
  const requestQueryParams = { ...debouncedQueryParams, period: effectivePeriod }
  const isChatMode = appDetail.mode !== 'completion'
  const supportsLogExport =
    appDetail.mode === 'chat' ||
    appDetail.mode === 'advanced-chat' ||
    appDetail.mode === 'agent-chat'

  const toFilters = (params: QueryParam) => {
    const { period, ...filters } = params
    const timePeriod = resolveLogTimePeriodOption(
      period,
      TIME_PERIOD_MAPPING[period]!,
      cloudSandboxPlanState,
    )
    return {
      ...filters,
      ...(period !== '9' ? logDateRange(timePeriod.value) : {}),
    }
  }
  const query = { ...toFilters(requestQueryParams), page: currPage + 1, limit }

  // When the details are obtained, proceed to the next request
  const { data: chatConversations, refetch: mutateChatList } = useQuery(
    consoleQuery.apps.byAppId.chatConversations.get.queryOptions({
      input: isChatMode ? { params: { app_id: appDetail.id }, query } : skipToken,
    }),
  )

  const { data: completionConversations, refetch: mutateCompletionList } = useQuery(
    consoleQuery.apps.byAppId.completionConversations.get.queryOptions({
      input: !isChatMode ? { params: { app_id: appDetail.id }, query } : skipToken,
    }),
  )

  const total = isChatMode ? chatConversations?.total : completionConversations?.total
  const totalPages = total ? Math.max(Math.ceil(total / limit), 1) : 1

  const handlePageChange = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString())
      const nextPageValue = page + 1
      if (nextPageValue === 1) params.delete('page')
      else params.set('page', String(nextPageValue))
      const queryString = params.toString()
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const handleQueryParamsChange = useCallback(
    (next: QueryParam) => {
      handlePageChange(0)
      setQueryParams(next)
    },
    [handlePageChange],
  )

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
          queryParams={effectiveQueryParams}
          setQueryParams={handleQueryParamsChange}
          actions={
            supportsLogExport &&
            canExportLogs && (
              <LogExportDialog
                key={appDetail.id}
                appId={appDetail.id}
                appName={appDetail.name}
                currentFilters={toFilters(effectiveQueryParams)}
                identityOptions={getLogIdentities(chatConversations?.data ?? [])}
                planState={cloudSandboxPlanState}
              />
            )
          }
        />
        <RetentionUpgradeNotice />
        <List
          logs={isChatMode ? chatConversations : completionConversations}
          appDetail={appDetail}
          onRefresh={isChatMode ? mutateChatList : mutateCompletionList}
        />
        {/* Show Pagination only if the total is more than the limit */}
        {total !== undefined && total > APP_PAGE_LIMIT ? (
          <Pagination
            page={currPage + 1}
            totalPages={totalPages}
            onPageChange={(page) => handlePageChange(page - 1)}
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
