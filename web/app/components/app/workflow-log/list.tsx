'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import s from './style.module.css'
import DetailPanel from './detail'
import type { WorkflowAppLogDetail, WorkflowLogsResponse } from '@/models/log'
import type { App } from '@/types/app'
import Loading from '@/app/components/base/loading'
import Drawer from '@/app/components/base/drawer'
import Indicator from '@/app/components/header/indicator'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'

type ILogs = {
  logs?: WorkflowLogsResponse
  appDetail?: App
  onRefresh: () => void
}

const defaultValue = 'N/A'

const WorkflowAppLogList: FC<ILogs> = ({ logs, appDetail, onRefresh }) => {
  const { t } = useTranslation()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const [showDrawer, setShowDrawer] = useState<boolean>(false)
  const [currentLog, setCurrentLog] = useState<WorkflowAppLogDetail | undefined>()

  const statusTdRender = (status: string) => {
    if (status === 'succeeded') {
      return (
        <div className='inline-flex items-center gap-1'>
          <Indicator color={'green'} />
          <span>Success</span>
        </div>
      )
    }
    if (status === 'failed') {
      return (
        <div className='inline-flex items-center gap-1'>
          <Indicator color={'red'} />
          <span className='text-red-600'>Fail</span>
        </div>
      )
    }
    if (status === 'stopped') {
      return (
        <div className='inline-flex items-center gap-1'>
          <Indicator color={'yellow'} />
          <span>Stop</span>
        </div>
      )
    }
    if (status === 'running') {
      return (
        <div className='inline-flex items-center gap-1'>
          <Indicator color={'blue'} />
          <span className='text-primary-600'>Running</span>
        </div>
      )
    }
  }

  const onCloseDrawer = () => {
    onRefresh()
    setShowDrawer(false)
    setCurrentLog(undefined)
  }

  if (!logs || !appDetail)
    return <Loading />

  return (
    <div className='overflow-x-auto'>
      <table className={`w-full min-w-[440px] border-collapse border-0 text-sm mt-3 ${s.logTable}`}>
        <thead className="h-8 !pl-3 py-2 leading-[18px] border-b border-gray-200 text-xs text-gray-500 font-medium">
          <tr>
            <td className='w-[1.375rem] whitespace-nowrap'></td>
            <td className='whitespace-nowrap'>{t('appLog.table.header.startTime')}</td>
            <td className='whitespace-nowrap'>{t('appLog.table.header.status')}</td>
            <td className='whitespace-nowrap'>{t('appLog.table.header.runtime')}</td>
            <td className='whitespace-nowrap'>{t('appLog.table.header.tokens')}</td>
            <td className='whitespace-nowrap'>{t('appLog.table.header.user')}</td>
            {/* <td className='whitespace-nowrap'>{t('appLog.table.header.version')}</td> */}
          </tr>
        </thead>
        <tbody className="text-gray-700 text-[13px]">
          {logs.data.map((log: WorkflowAppLogDetail) => {
            const endUser = log.created_by_end_user ? log.created_by_end_user.session_id : defaultValue
            return <tr
              key={log.id}
              className={`border-b border-gray-200 h-8 hover:bg-gray-50 cursor-pointer ${currentLog?.id !== log.id ? '' : 'bg-gray-50'}`}
              onClick={() => {
                setCurrentLog(log)
                setShowDrawer(true)
              }}>
              <td className='text-center align-middle'>{!log.read_at && <span className='inline-block bg-[#3F83F8] h-1.5 w-1.5 rounded'></span>}</td>
              <td className='w-[160px]'>{dayjs.unix(log.created_at).format(t('appLog.dateTimeFormat') as string)}</td>
              <td>{statusTdRender(log.workflow_run.status)}</td>
              <td>
                <div className={cn(
                  log.workflow_run.elapsed_time === 0 && 'text-gray-400',
                )}>{`${log.workflow_run.elapsed_time.toFixed(3)}s`}</div>
              </td>
              <td>{log.workflow_run.total_tokens}</td>
              <td>
                <div className={cn(endUser === defaultValue ? 'text-gray-400' : 'text-gray-700', 'text-sm overflow-hidden text-ellipsis whitespace-nowrap')}>
                  {endUser}
                </div>
              </td>
              {/* <td>VERSION</td> */}
            </tr>
          })}
        </tbody>
      </table>
      <Drawer
        isOpen={showDrawer}
        onClose={onCloseDrawer}
        mask={isMobile}
        footer={null}
        panelClassname='mt-16 mx-2 sm:mr-2 mb-3 !p-0 !max-w-[600px] rounded-xl border border-gray-200'
      >
        <DetailPanel onClose={onCloseDrawer} runID={currentLog?.workflow_run.id || ''} />
      </Drawer>
    </div>
  )
}

export default WorkflowAppLogList
