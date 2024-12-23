'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import DetailPanel from './detail'
import type { WorkflowAppLogDetail, WorkflowLogsResponse } from '@/models/log'
import type { App } from '@/types/app'
import Loading from '@/app/components/base/loading'
import Drawer from '@/app/components/base/drawer'
import Indicator from '@/app/components/header/indicator'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useTimestamp from '@/hooks/use-timestamp'
import cn from '@/utils/classnames'

type ILogs = {
  logs?: WorkflowLogsResponse
  appDetail?: App
  onRefresh: () => void
}

const defaultValue = 'N/A'

const WorkflowAppLogList: FC<ILogs> = ({ logs, appDetail, onRefresh }) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const [showDrawer, setShowDrawer] = useState<boolean>(false)
  const [currentLog, setCurrentLog] = useState<WorkflowAppLogDetail | undefined>()

  const statusTdRender = (status: string) => {
    if (status === 'succeeded') {
      return (
        <div className='inline-flex items-center gap-1 system-xs-semibold-uppercase'>
          <Indicator color={'green'} />
          <span className='text-util-colors-green-green-600'>Success</span>
        </div>
      )
    }
    if (status === 'failed') {
      return (
        <div className='inline-flex items-center gap-1 system-xs-semibold-uppercase'>
          <Indicator color={'red'} />
          <span className='text-util-colors-red-red-600'>Fail</span>
        </div>
      )
    }
    if (status === 'stopped') {
      return (
        <div className='inline-flex items-center gap-1 system-xs-semibold-uppercase'>
          <Indicator color={'yellow'} />
          <span className='text-util-colors-warning-warning-600'>Stop</span>
        </div>
      )
    }
    if (status === 'running') {
      return (
        <div className='inline-flex items-center gap-1 system-xs-semibold-uppercase'>
          <Indicator color={'blue'} />
          <span className='text-util-colors-blue-light-blue-light-600'>Running</span>
        </div>
      )
    }
    if (status === 'partial-succeeded') {
      return (
        <div className='inline-flex items-center gap-1 system-xs-semibold-uppercase'>
          <Indicator color={'green'} />
          <span className='text-util-colors-green-green-600'>Partial Success</span>
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
      <table className={cn('mt-2 w-full min-w-[440px] border-collapse border-0')}>
        <thead className='system-xs-medium-uppercase text-text-tertiary'>
          <tr>
            <td className='pl-2 pr-1 w-5 rounded-l-lg bg-background-section-burn whitespace-nowrap'></td>
            <td className='pl-3 py-1.5 bg-background-section-burn whitespace-nowrap'>{t('appLog.table.header.startTime')}</td>
            <td className='pl-3 py-1.5 bg-background-section-burn whitespace-nowrap'>{t('appLog.table.header.status')}</td>
            <td className='pl-3 py-1.5 bg-background-section-burn whitespace-nowrap'>{t('appLog.table.header.runtime')}</td>
            <td className='pl-3 py-1.5 bg-background-section-burn whitespace-nowrap'>{t('appLog.table.header.tokens')}</td>
            <td className='pl-3 py-1.5 rounded-r-lg bg-background-section-burn whitespace-nowrap'>{t('appLog.table.header.user')}</td>
          </tr>
        </thead>
        <tbody className="text-text-secondary system-sm-regular">
          {logs.data.map((log: WorkflowAppLogDetail) => {
            const endUser = log.created_by_end_user ? log.created_by_end_user.session_id : log.created_by_account ? log.created_by_account.name : defaultValue
            return <tr
              key={log.id}
              className={cn('border-b border-divider-subtle hover:bg-background-default-hover cursor-pointer', currentLog?.id !== log.id ? '' : 'bg-background-default-hover')}
              onClick={() => {
                setCurrentLog(log)
                setShowDrawer(true)
              }}>
              <td className='h-4'>
                {!log.read_at && (
                  <div className='p-3 pr-0.5 flex items-center'>
                    <span className='inline-block bg-util-colors-blue-blue-500 h-1.5 w-1.5 rounded'></span>
                  </div>
                )}
              </td>
              <td className='p-3 pr-2 w-[160px]'>{formatTime(log.created_at, t('appLog.dateTimeFormat') as string)}</td>
              <td className='p-3 pr-2'>{statusTdRender(log.workflow_run.status)}</td>
              <td className='p-3 pr-2'>
                <div className={cn(
                  log.workflow_run.elapsed_time === 0 && 'text-text-quaternary',
                )}>{`${log.workflow_run.elapsed_time.toFixed(3)}s`}</div>
              </td>
              <td className='p-3 pr-2'>{log.workflow_run.total_tokens}</td>
              <td className='p-3 pr-2'>
                <div className={cn(endUser === defaultValue ? 'text-text-quaternary' : 'text-text-secondary', 'overflow-hidden text-ellipsis whitespace-nowrap')}>
                  {endUser}
                </div>
              </td>
            </tr>
          })}
        </tbody>
      </table>
      <Drawer
        isOpen={showDrawer}
        onClose={onCloseDrawer}
        mask={isMobile}
        footer={null}
        panelClassname='mt-16 mx-2 sm:mr-2 mb-3 !p-0 !max-w-[600px] rounded-xl border border-components-panel-border'
      >
        <DetailPanel onClose={onCloseDrawer} runID={currentLog?.workflow_run.id || ''} />
      </Drawer>
    </div>
  )
}

export default WorkflowAppLogList
