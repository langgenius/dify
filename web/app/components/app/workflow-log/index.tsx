'use client'
import type { FC } from 'react'
import type { App } from '@/types/app'
import { useDebounce } from 'ahooks'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { omit } from 'es-toolkit/object'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import EmptyElement from '@/app/components/app/log/empty-element'
import Loading from '@/app/components/base/loading'
import Pagination from '@/app/components/base/pagination'
import { APP_PAGE_LIMIT } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useWorkflowLogs } from '@/service/use-log'
import Filter, { TIME_PERIOD_MAPPING } from './filter'
import List from './list'

dayjs.extend(utc)
dayjs.extend(timezone)

export type ILogsProps = {
  appDetail: App
}

export type QueryParam = {
  period: string
  status?: string
  keyword?: string
}

const Logs: FC<ILogsProps> = ({ appDetail }) => {
  const { t } = useTranslation()
  const { userProfile: { timezone } } = useAppContext()
  const [queryParams, setQueryParams] = useState<QueryParam>({ status: 'all', period: '2' })
  const [currPage, setCurrPage] = React.useState<number>(0)
  const debouncedQueryParams = useDebounce(queryParams, { wait: 500 })
  const [limit, setLimit] = React.useState<number>(APP_PAGE_LIMIT)

  const query = {
    page: currPage + 1,
    detail: true,
    limit,
    ...(debouncedQueryParams.status !== 'all' ? { status: debouncedQueryParams.status } : {}),
    ...(debouncedQueryParams.keyword ? { keyword: debouncedQueryParams.keyword } : {}),
    ...((debouncedQueryParams.period !== '9')
      ? {
          created_at__after: dayjs().subtract(TIME_PERIOD_MAPPING[debouncedQueryParams.period].value, 'day').startOf('day').tz(timezone).format('YYYY-MM-DDTHH:mm:ssZ'),
          created_at__before: dayjs().endOf('day').tz(timezone).format('YYYY-MM-DDTHH:mm:ssZ'),
        }
      : {}),
    ...omit(debouncedQueryParams, ['period', 'status']),
  }

  const { data: workflowLogs, refetch: mutate } = useWorkflowLogs({
    appId: appDetail.id,
    params: query,
  })
  const total = workflowLogs?.total

  return (
    <div className="flex h-full flex-col">
      <h1 className="system-xl-semibold text-text-primary">{t('workflowTitle', { ns: 'appLog' })}</h1>
      <p className="system-sm-regular text-text-tertiary">{t('workflowSubtitle', { ns: 'appLog' })}</p>
      <div className="flex max-h-[calc(100%-16px)] flex-1 flex-col py-4">
        <Filter queryParams={queryParams} setQueryParams={setQueryParams} />
        {/* workflow log */}
        {total === undefined
          ? <Loading type="app" />
          : total > 0
            ? <List logs={workflowLogs} appDetail={appDetail} onRefresh={mutate} />
            : <EmptyElement appDetail={appDetail} />}
        {/* Show Pagination only if the total is more than the limit */}
        {(total && total > APP_PAGE_LIMIT)
          ? (
              <Pagination
                current={currPage}
                onChange={setCurrPage}
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
