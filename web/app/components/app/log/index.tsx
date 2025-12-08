'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import useSWR from 'swr'
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
import { fetchChatConversations, fetchCompletionConversations } from '@/service/log'
import { APP_PAGE_LIMIT } from '@/config'
import type { App } from '@/types/app'
import { AppModeEnum } from '@/types/app'
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

  const query = {
    page: currPage + 1,
    limit,
    ...((debouncedQueryParams.period !== '9')
      ? {
        start: dayjs().subtract(TIME_PERIOD_MAPPING[debouncedQueryParams.period].value, 'day').startOf('day').format('YYYY-MM-DD HH:mm'),
        end: dayjs().endOf('day').format('YYYY-MM-DD HH:mm'),
      }
      : {}),
    ...(isChatMode ? { sort_by: debouncedQueryParams.sort_by } : {}),
    ...omit(debouncedQueryParams, ['period']),
  }

  // When the details are obtained, proceed to the next request
  const { data: chatConversations, mutate: mutateChatList } = useSWR(() => isChatMode
    ? {
      url: `/apps/${appDetail.id}/chat-conversations`,
      params: query,
    }
    : null, fetchChatConversations)

  const { data: completionConversations, mutate: mutateCompletionList } = useSWR(() => !isChatMode
    ? {
      url: `/apps/${appDetail.id}/completion-conversations`,
      params: query,
    }
    : null, fetchCompletionConversations)

  const total = isChatMode ? chatConversations?.total : completionConversations?.total

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
        {total === undefined
          ? <Loading type='app' />
          : total > 0
            ? <List logs={isChatMode ? chatConversations : completionConversations} appDetail={appDetail} onRefresh={isChatMode ? mutateChatList : mutateCompletionList} />
            : <EmptyElement appDetail={appDetail} />
        }
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
