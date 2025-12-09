'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebounce } from 'ahooks'
import { omit } from 'lodash-es'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import List from './list'
import Filter, { TIME_PERIOD_MAPPING } from './filter'
import EmptyElement from './empty-element'
import Pagination from '@/app/components/base/pagination'
import Loading from '@/app/components/base/loading'
import { useChatConversations, useCompletionConversations } from '@/service/use-log'
import { APP_PAGE_LIMIT } from '@/config'
import type { App } from '@/types/app'
import { AppModeEnum } from '@/types/app'
import type { ChatConversationsRequest, CompletionConversationsRequest } from '@/models/log'
export type ILogsProps = {
  appDetail: App
}

export type QueryParam = {
  period: string
  annotation_status?: string
  keyword?: string
  sort_by?: string
}

const defaultQueryParams: QueryParam = {
  period: '2',
  annotation_status: 'all',
  sort_by: '-created_at',
}

const logsStateCache = new Map<string, {
  queryParams: QueryParam
  currPage: number
  limit: number
}>()

const Logs: FC<ILogsProps> = ({ appDetail }) => {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const getPageFromParams = useCallback(() => {
    const pageParam = Number.parseInt(searchParams.get('page') || '1', 10)
    if (Number.isNaN(pageParam) || pageParam < 1)
      return 0
    return pageParam - 1
  }, [searchParams])
  const cachedState = logsStateCache.get(appDetail.id)
  const [queryParams, setQueryParams] = useState<QueryParam>(cachedState?.queryParams ?? defaultQueryParams)
  const [currPage, setCurrPage] = React.useState<number>(() => cachedState?.currPage ?? getPageFromParams())
  const [limit, setLimit] = React.useState<number>(cachedState?.limit ?? APP_PAGE_LIMIT)
  const debouncedQueryParams = useDebounce(queryParams, { wait: 500 })

  useEffect(() => {
    const pageFromParams = getPageFromParams()
    setCurrPage(prev => (prev === pageFromParams ? prev : pageFromParams))
  }, [getPageFromParams])

  useEffect(() => {
    logsStateCache.set(appDetail.id, {
      queryParams,
      currPage,
      limit,
    })
  }, [appDetail.id, currPage, limit, queryParams])

  // Get the app type first
  const isChatMode = appDetail.mode !== AppModeEnum.COMPLETION

  const completionQuery = useMemo<CompletionConversationsRequest & { sort_by?: string }>(() => ({
    page: currPage + 1,
    limit,
    keyword: debouncedQueryParams.keyword ?? '',
    annotation_status: debouncedQueryParams.annotation_status ?? 'all',
    start: debouncedQueryParams.period !== '9'
      ? dayjs().subtract(TIME_PERIOD_MAPPING[debouncedQueryParams.period].value, 'day').startOf('day').format('YYYY-MM-DD HH:mm')
      : '',
    end: debouncedQueryParams.period !== '9'
      ? dayjs().endOf('day').format('YYYY-MM-DD HH:mm')
      : '',
    ...omit(debouncedQueryParams, ['period', 'sort_by', 'keyword', 'annotation_status']),
  }), [currPage, debouncedQueryParams, limit])

  const chatQuery = useMemo<ChatConversationsRequest & { sort_by?: string }>(() => ({
    ...completionQuery,
    sort_by: debouncedQueryParams.sort_by,
    message_count: (debouncedQueryParams as any).message_count ?? 0,
  }), [completionQuery, debouncedQueryParams.sort_by, isChatMode])

  // When the details are obtained, proceed to the next request
  const { data: chatConversations, refetch: refetchChatList } = useChatConversations(appDetail.id, chatQuery, isChatMode)

  const { data: completionConversations, refetch: refetchCompletionList } = useCompletionConversations(appDetail.id, completionQuery, !isChatMode)

  const total = isChatMode ? chatConversations?.total : completionConversations?.total

  const handleRefreshList = useCallback(() => {
    if (isChatMode) {
      void refetchChatList()
      return
    }
    void refetchCompletionList()
  }, [isChatMode, refetchChatList, refetchCompletionList])

  const handleQueryParamsChange = useCallback((next: QueryParam) => {
    setCurrPage(0)
    setQueryParams(next)
  }, [])

  const handlePageChange = useCallback((page: number) => {
    setCurrPage(page)
    const params = new URLSearchParams(searchParams.toString())
    const nextPageValue = page + 1
    if (nextPageValue === 1)
      params.delete('page')
    else
      params.set('page', String(nextPageValue))
    const queryString = params.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])

  return (
    <div className='flex h-full grow flex-col'>
      <p className='system-sm-regular shrink-0 text-text-tertiary'>{t('appLog.description')}</p>
      <div className='flex max-h-[calc(100%-16px)] flex-1 grow flex-col py-4'>
        <Filter isChatMode={isChatMode} appId={appDetail.id} queryParams={queryParams} setQueryParams={handleQueryParamsChange} />
        {(() => {
          if (total === undefined)
            return <Loading type='app' />
          if (total > 0)
            return <List logs={isChatMode ? chatConversations : completionConversations} appDetail={appDetail} onRefresh={handleRefreshList} />
          return <EmptyElement appDetail={appDetail} />
        })()}
        {/* Show Pagination only if the total is more than the limit */}
        {(total && total > APP_PAGE_LIMIT)
          ? <Pagination
            current={currPage}
            onChange={handlePageChange}
            total={total}
            limit={limit}
            onLimitChange={setLimit}
          />
          : null}
      </div>
    </div>
  )
}

export default Logs
