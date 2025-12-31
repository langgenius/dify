'use client'
import type { FC } from 'react'
import type { App } from '@/types/app'
import { useDebounce } from 'ahooks'
import dayjs from 'dayjs'
import { omit } from 'es-toolkit/object'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
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
    <div className="flex h-full grow flex-col">
      <p className="system-sm-regular shrink-0 text-text-tertiary">{t('description', { ns: 'appLog' })}</p>
      <div className="flex max-h-[calc(100%-16px)] flex-1 grow flex-col py-4">
        <Filter isChatMode={isChatMode} appId={appDetail.id} queryParams={queryParams} setQueryParams={handleQueryParamsChange} />
        {total === undefined
          ? <Loading type="app" />
          : total > 0
            ? <List logs={isChatMode ? chatConversations : completionConversations} appDetail={appDetail} onRefresh={isChatMode ? mutateChatList : mutateCompletionList} />
            : <EmptyElement appDetail={appDetail} />}
        {/* Show Pagination only if the total is more than the limit */}
        {(total && total > APP_PAGE_LIMIT)
          ? (
              <Pagination
                current={currPage}
                onChange={handlePageChange}
                total={total}
                limit={limit}
                onLimitChange={setLimit}
              />
            )
          : null}
      </div>
    </div>
  )
}

export default Logs
