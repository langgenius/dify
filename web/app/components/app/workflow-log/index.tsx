'use client'
import type { FC, SVGProps } from 'react'
import React, { useState } from 'react'
import useSWR from 'swr'
import { usePathname } from 'next/navigation'
import { Pagination } from 'react-headless-pagination'
import { ArrowLeftIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import { Trans, useTranslation } from 'react-i18next'
import Link from 'next/link'
import Toast from '../../base/toast'
import List from './list'
import Filter from './filter'
import s from './style.module.css'
import Loading from '@/app/components/base/loading'
import { fetchWorkflowLogs } from '@/service/log'
import { APP_PAGE_LIMIT } from '@/config'
import type { App, AppMode } from '@/types/app'

export type ILogsProps = {
  appDetail: App
}

export type QueryParam = {
  status?: string
  keyword?: string
}

const ThreeDotsIcon = ({ className }: SVGProps<SVGElement>) => {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <path d="M5 6.5V5M8.93934 7.56066L10 6.5M10.0103 11.5H11.5103" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}
const EmptyElement: FC<{ appUrl: string }> = ({ appUrl }) => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const pathSegments = pathname.split('/')
  pathSegments.pop()
  return <div className='flex items-center justify-center h-full'>
    <div className='bg-gray-50 w-[560px] h-fit box-border px-5 py-4 rounded-2xl'>
      <span className='text-gray-700 font-semibold'>{t('appLog.table.empty.element.title')}<ThreeDotsIcon className='inline relative -top-3 -left-1.5' /></span>
      <div className='mt-2 text-gray-500 text-sm font-normal'>
        <Trans
          i18nKey="appLog.table.empty.element.content"
          components={{ shareLink: <Link href={`${pathSegments.join('/')}/overview`} className='text-primary-600' />, testLink: <Link href={appUrl} className='text-primary-600' target='_blank' rel='noopener noreferrer' /> }}
        />
      </div>
    </div>
  </div>
}

const Logs: FC<ILogsProps> = ({ appDetail }) => {
  const { t } = useTranslation()
  const [queryParams, setQueryParams] = useState<QueryParam>({ status: 'all' })
  const [currPage, setCurrPage] = React.useState<number>(0)
  const [inputPage, setInputPage] = React.useState<string>('')
  const query = {
    page: currPage + 1,
    limit: APP_PAGE_LIMIT,
    ...(queryParams.status !== 'all' ? { status: queryParams.status } : {}),
    ...(queryParams.keyword ? { keyword: queryParams.keyword } : {}),
  }

  const getWebAppType = (appType: AppMode) => {
    if (appType !== 'completion' && appType !== 'workflow')
      return 'chat'
    return appType
  }

  const { data: workflowLogs, mutate } = useSWR({
    url: `/apps/${appDetail.id}/workflow-app-logs`,
    params: query,
  }, fetchWorkflowLogs)
  const total = workflowLogs?.total
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputPage(event.target.value)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      if (Number(inputPage) <= 0 || Number(inputPage) - 1 > Math.ceil(Number(total) / APP_PAGE_LIMIT) - 1) {
        Toast.notify({
          message: t('appLog.table.pagination.invalidPageNum'),
          type: 'error',
        })
        setInputPage('')
        return
      }

      if (Number(inputPage) !== currPage + 1)
        setCurrPage(Number(inputPage) - 1)
      setInputPage('')
    }
  }
  return (
    <div className='flex flex-col h-full'>
      <h1 className='text-md font-semibold text-gray-900'>{t('appLog.workflowTitle')}</h1>
      <p className='flex text-sm font-normal text-gray-500'>{t('appLog.workflowSubtitle')}</p>
      <div className='flex flex-col py-4 flex-1'>
        <Filter queryParams={queryParams} setQueryParams={setQueryParams} />
        {/* workflow log */}
        {total === undefined
          ? <Loading type='app' />
          : total > 0
            ? <List logs={workflowLogs} appDetail={appDetail} onRefresh={mutate} />
            : <EmptyElement appUrl={`${appDetail.site.app_base_url}/${getWebAppType(appDetail.mode)}/${appDetail.site.access_token}`} />
        }
        {/* Show Pagination only if the total is more than the limit */}
        {(total && total > APP_PAGE_LIMIT)
          ? <Pagination
            className="flex items-center w-full h-10 text-sm select-none mt-8"
            currentPage={currPage}
            edgePageCount={2}
            middlePagesSiblingCount={1}
            setCurrentPage={setCurrPage}
            totalPages={Math.ceil(total / APP_PAGE_LIMIT)}
            truncableClassName="w-8 px-0.5 text-center"
            truncableText="..."
          >
            <div className='flex-1'></div>
            <Pagination.PrevButton
              disabled={currPage === 0}
              className={`flex items-center my-2 text-gray-500  focus:outline-none ${currPage === 0 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:text-gray-600 dark:hover:text-gray-200'}`} >
              <ArrowLeftIcon className="mr-3 h-3 w-3" />
            </Pagination.PrevButton>
            <div className={`flex items-center justify-center shrink ${s.pagination}`}>
              <Pagination.PageButton
                activeClassName="bg-primary-50 dark:bg-opacity-0 text-primary-600 dark:text-white"
                className="flex items-center justify-center h-8 w-8 rounded-full cursor-pointer"
                inactiveClassName="text-gray-500"
              />
            </div>
            <Pagination.NextButton
              disabled={currPage === Math.ceil(total / APP_PAGE_LIMIT) - 1}
              className={`flex items-center mr-2 text-gray-500 focus:outline-none ${currPage === Math.ceil(total / APP_PAGE_LIMIT) - 1 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:text-gray-600 dark:hover:text-gray-200'}`} >
              <ArrowRightIcon className="ml-3 h-3 w-3" />
            </Pagination.NextButton>
            <div className='flex gap-2 items-center'>
              <span>{t('appLog.table.pagination.goTo')}</span>
              <input
                className={'appearance-none py-1 px-3 inline-block w-10 rounded-md border border-gray-200 hover:border-gray-300 hover:shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 placeholder-gray-400 caret-primary-600 sm:text-sm'}
                onChange={handleInputChange}
                value={inputPage}
                onKeyDown={handleKeyDown}
              />
              {t('appLog.table.pagination.page')}
            </div>
          </Pagination>
          : null}
      </div>
    </div>
  )
}

export default Logs
