'use client'

import type {
  AppDetailWithSite,
  GetAppsByAppIdChatConversationsData,
} from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import dayjs from 'dayjs'
import { omit } from 'es-toolkit/object'
import { parseAsInteger, useQueryState } from 'nuqs'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { APP_PAGE_LIMIT } from '@/config'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import PageTitle from '../log-annotation/page-title'
import {
  resolveLogTimePeriod,
  resolveLogTimePeriodOption,
  useCloudSandboxPlanStatus,
} from './cloud-sandbox-retention'
import Filter, { TIME_PERIOD_MAPPING } from './filter'
import List from './list'
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
  const [pageParam, setPageParam] = useQueryState('page', parseAsInteger)
  const page = Math.max(pageParam ?? 1, 1)
  const cloudSandboxPlanState = useCloudSandboxPlanStatus()
  const cachedState = logsStateCache.get(appDetail.id)
  const [queryParams, setQueryParams] = useState<QueryParam>(
    cachedState?.queryParams ?? defaultQueryParams,
  )
  const [appliedQueryParams, setAppliedQueryParams] = useState(queryParams)
  const [limit, setLimit] = useState(cachedState?.limit ?? APP_PAGE_LIMIT)
  useEffect(() => {
    logsStateCache.set(appDetail.id, { queryParams, limit })
  }, [appDetail.id, queryParams, limit])

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
  const requestTimePeriod = resolveLogTimePeriodOption(
    requestQueryParams.period,
    TIME_PERIOD_MAPPING[requestQueryParams.period]!,
    cloudSandboxPlanState,
  )

  // Get the app type first
  const isChatMode = appDetail.mode !== 'completion'

  const query = {
    page,
    limit,
    ...(requestQueryParams.period !== '9'
      ? {
          start: dayjs()
            .subtract(requestTimePeriod.value, 'day')
            .startOf('day')
            .format('YYYY-MM-DD HH:mm'),
          end: dayjs().endOf('day').format('YYYY-MM-DD HH:mm'),
        }
      : {}),
    ...(isChatMode ? { sort_by: requestQueryParams.sort_by } : {}),
    ...omit(requestQueryParams, ['period']),
  }

  // When the details are obtained, proceed to the next request
  const chatConversationsQuery = useQuery(
    consoleQuery.apps.byAppId.chatConversations.get.queryOptions({
      input: isChatMode ? { params: { app_id: appDetail.id }, query } : skipToken,
    }),
  )
  const { data: chatConversations, refetch: mutateChatList } = chatConversationsQuery

  const completionConversationsQuery = useQuery(
    consoleQuery.apps.byAppId.completionConversations.get.queryOptions({
      input: !isChatMode ? { params: { app_id: appDetail.id }, query } : skipToken,
    }),
  )
  const { data: completionConversations, refetch: mutateCompletionList } =
    completionConversationsQuery
  const conversationsQuery = isChatMode ? chatConversationsQuery : completionConversationsQuery
  const failedLoad = useOwnedQueryError(conversationsQuery)
  const loadErrorMessage = useRequestErrorMessage(
    failedLoad?.error,
    t(($) => $['api.actionFailed'], { ns: 'common' }),
  )

  const total = isChatMode ? chatConversations?.total : completionConversations?.total
  const totalPages = total ? Math.max(Math.ceil(total / limit), 1) : 1

  const handleQueryParamsChange = (next: QueryParam) => {
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
          queryParams={effectiveQueryParams}
          setQueryParams={handleQueryParamsChange}
        />
        <RetentionUpgradeNotice />
        {loadErrorMessage && failedLoad ? (
          <Alert type="error" className="mt-2 shrink-0">
            <AlertTitle>{loadErrorMessage}</AlertTitle>
            <AlertActions>
              <Button size="small" loading={failedLoad.retrying} onClick={failedLoad.retry}>
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </AlertActions>
          </Alert>
        ) : (
          <List
            logs={isChatMode ? chatConversations : completionConversations}
            appDetail={appDetail}
            onRefresh={isChatMode ? mutateChatList : mutateCompletionList}
          />
        )}
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
