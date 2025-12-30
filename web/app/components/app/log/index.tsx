'use client'
import type { FC } from 'react'
import type { App } from '@/types/app'
import { useDebounce } from 'ahooks'
import dayjs from 'dayjs'
import { omit } from 'es-toolkit/compat'
import {
  parseAsInteger,
  parseAsString,
  useQueryStates,
} from 'nuqs'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import Pagination from '@/app/components/base/pagination'
import { APP_PAGE_LIMIT } from '@/config'
import { useChatConversations, useCompletionConversations } from '@/service/use-log'
import { AppModeEnum } from '@/types/app'
import EmptyElement from './empty-element'
import Filter, { TIME_PERIOD_MAPPING } from './filter'
import List from './list'

export type ILogsProps = {
  appDetail: App
}

export type QueryParam = {
  period: string
  annotation_status?: string
  keyword?: string
  sort_by?: string
}

const Logs: FC<ILogsProps> = ({ appDetail }) => {
  const { t } = useTranslation()

  const [queryParams, setQueryParams] = useQueryStates(
    {
      page: parseAsInteger.withDefault(1),
      limit: parseAsInteger.withDefault(APP_PAGE_LIMIT),
      period: parseAsString.withDefault('2'),
      annotation_status: parseAsString.withDefault('all'),
      keyword: parseAsString,
      sort_by: parseAsString.withDefault('-created_at'),
    },
    {
      urlKeys: {
        page: 'page',
        limit: 'limit',
        period: 'period',
        annotation_status: 'annotation_status',
        keyword: 'keyword',
        sort_by: 'sort_by',
      },
    },
  )

  const debouncedQueryParams = useDebounce(queryParams, { wait: 500 })
  const page = queryParams.page > 0 ? queryParams.page : 1
  const limit = queryParams.limit > 0 ? queryParams.limit : APP_PAGE_LIMIT

  // Get the app type first
  const isChatMode = appDetail.mode !== AppModeEnum.COMPLETION

  const query = {
    page,
    limit,
    ...((debouncedQueryParams.period !== '9')
      ? {
          start: dayjs().subtract(TIME_PERIOD_MAPPING[debouncedQueryParams.period].value, 'day').startOf('day').format('YYYY-MM-DD HH:mm'),
          end: dayjs().endOf('day').format('YYYY-MM-DD HH:mm'),
        }
      : {}),
    ...(isChatMode ? { sort_by: debouncedQueryParams.sort_by } : {}),
    ...omit(debouncedQueryParams, ['period', 'page', 'limit']),
    keyword: debouncedQueryParams.keyword || undefined,
  }

  // When the details are obtained, proceed to the next request
  const { data: chatConversations, refetch: mutateChatList } = useChatConversations({
    appId: isChatMode ? appDetail.id : '',
    params: query,
  })

  const { data: completionConversations, refetch: mutateCompletionList } = useCompletionConversations({
    appId: !isChatMode ? appDetail.id : '',
    params: query,
  })

  const total = isChatMode ? chatConversations?.total : completionConversations?.total

  const handleQueryParamsChange = useCallback((next: QueryParam) => {
    setQueryParams({
      ...next,
      page: 1, // Reset to page 1 on filter change
    })
  }, [setQueryParams])

  const handlePageChange = useCallback((page: number) => {
    setQueryParams({ page: page + 1 })
  }, [setQueryParams])

  const handleLimitChange = useCallback((limit: number) => {
    setQueryParams({ limit, page: 1 })
  }, [setQueryParams])

  return (
    <div className="flex h-full grow flex-col">
      <p className="system-sm-regular shrink-0 text-text-tertiary">{t('description', { ns: 'appLog' })}</p>
      <div className="flex max-h-[calc(100%-16px)] flex-1 grow flex-col py-4">
        <Filter isChatMode={isChatMode} appId={appDetail.id} queryParams={{ ...queryParams, keyword: queryParams.keyword || undefined }} setQueryParams={handleQueryParamsChange} />
        {total === undefined
          ? <Loading type="app" />
          : total > 0
            ? <List logs={isChatMode ? chatConversations : completionConversations} appDetail={appDetail} onRefresh={isChatMode ? mutateChatList : mutateCompletionList} />
            : <EmptyElement appDetail={appDetail} />}
        {/* Show Pagination only if the total is more than the limit */}
        {(total && total > APP_PAGE_LIMIT)
          ? (
              <Pagination
                current={page - 1}
                onChange={handlePageChange}
                total={total}
                limit={limit}
                onLimitChange={handleLimitChange}
              />
            )
          : null}
      </div>
    </div>
  )
}

export default Logs
