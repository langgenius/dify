'use client'
import type { FC } from 'react'
import type { WorkflowAppLogDetail, WorkflowLogsResponse, WorkflowRunTriggeredFrom } from '@/models/log'
import type { App } from '@/types/app'
import { ArrowDownIcon } from '@heroicons/react/24/outline'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Drawer from '@/app/components/base/drawer'
import Loading from '@/app/components/base/loading'
import Indicator from '@/app/components/header/indicator'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useTimestamp from '@/hooks/use-timestamp'
import { AppModeEnum } from '@/types/app'
import { cn } from '@/utils/classnames'
import DetailPanel from './detail'
import TriggerByDisplay from './trigger-by-display'

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
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [localLogs, setLocalLogs] = useState<WorkflowAppLogDetail[]>(logs?.data || [])

  useEffect(() => {
    if (!logs?.data) {
      setLocalLogs([])
      return
    }

    const sortedLogs = [...logs.data].sort((a, b) => {
      const result = a.created_at - b.created_at
      return sortOrder === 'asc' ? result : -result
    })

    setLocalLogs(sortedLogs)
  }, [logs?.data, sortOrder])

  const handleSort = () => {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
  }

  const isWorkflow = appDetail?.mode === AppModeEnum.WORKFLOW

  const statusTdRender = (status: string) => {
    if (status === 'succeeded') {
      return (
        <div className="system-xs-semibold-uppercase inline-flex items-center gap-1">
          <Indicator color="green" />
          <span className="text-util-colors-green-green-600">Success</span>
        </div>
      )
    }
    if (status === 'failed') {
      return (
        <div className="system-xs-semibold-uppercase inline-flex items-center gap-1">
          <Indicator color="red" />
          <span className="text-util-colors-red-red-600">Failure</span>
        </div>
      )
    }
    if (status === 'stopped') {
      return (
        <div className="system-xs-semibold-uppercase inline-flex items-center gap-1">
          <Indicator color="yellow" />
          <span className="text-util-colors-warning-warning-600">Stop</span>
        </div>
      )
    }
    if (status === 'running') {
      return (
        <div className="system-xs-semibold-uppercase inline-flex items-center gap-1">
          <Indicator color="blue" />
          <span className="text-util-colors-blue-light-blue-light-600">Running</span>
        </div>
      )
    }
    if (status === 'partial-succeeded') {
      return (
        <div className="system-xs-semibold-uppercase inline-flex items-center gap-1">
          <Indicator color="green" />
          <span className="text-util-colors-green-green-600">Partial Success</span>
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
    <div className="overflow-x-auto">
      <table className={cn('mt-2 w-full min-w-[440px] border-collapse border-0')}>
        <thead className="system-xs-medium-uppercase text-text-tertiary">
          <tr>
            <td className="w-5 whitespace-nowrap rounded-l-lg bg-background-section-burn pl-2 pr-1"></td>
            <td className="whitespace-nowrap bg-background-section-burn py-1.5 pl-3">
              <div className="flex cursor-pointer items-center hover:text-text-secondary" onClick={handleSort}>
                {t('table.header.startTime', { ns: 'appLog' })}
                <ArrowDownIcon
                  className={cn('ml-0.5 h-3 w-3 stroke-current stroke-2 transition-all', 'text-text-tertiary', sortOrder === 'asc' ? 'rotate-180' : '')}
                />
              </div>
            </td>
            <td className="whitespace-nowrap bg-background-section-burn py-1.5 pl-3">{t('table.header.status', { ns: 'appLog' })}</td>
            <td className="whitespace-nowrap bg-background-section-burn py-1.5 pl-3">{t('table.header.runtime', { ns: 'appLog' })}</td>
            <td className="whitespace-nowrap bg-background-section-burn py-1.5 pl-3">{t('table.header.tokens', { ns: 'appLog' })}</td>
            <td className={cn('whitespace-nowrap bg-background-section-burn py-1.5 pl-3', !isWorkflow ? 'rounded-r-lg' : '')}>{t('table.header.user', { ns: 'appLog' })}</td>
            {isWorkflow && <td className="whitespace-nowrap rounded-r-lg bg-background-section-burn py-1.5 pl-3">{t('table.header.triggered_from', { ns: 'appLog' })}</td>}
          </tr>
        </thead>
        <tbody className="system-sm-regular text-text-secondary">
          {localLogs.map((log: WorkflowAppLogDetail) => {
            const endUser = log.created_by_end_user ? log.created_by_end_user.session_id : log.created_by_account ? log.created_by_account.name : defaultValue
            return (
              <tr
                key={log.id}
                className={cn('cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover', currentLog?.id !== log.id ? '' : 'bg-background-default-hover')}
                onClick={() => {
                  setCurrentLog(log)
                  setShowDrawer(true)
                }}
              >
                <td className="h-4">
                  {!log.read_at && (
                    <div className="flex items-center p-3 pr-0.5">
                      <span className="inline-block h-1.5 w-1.5 rounded bg-util-colors-blue-blue-500"></span>
                    </div>
                  )}
                </td>
                <td className="w-[180px] p-3 pr-2">{formatTime(log.created_at, t('dateTimeFormat', { ns: 'appLog' }) as string)}</td>
                <td className="p-3 pr-2">{statusTdRender(log.workflow_run.status)}</td>
                <td className="p-3 pr-2">
                  <div className={cn(
                    log.workflow_run.elapsed_time === 0 && 'text-text-quaternary',
                  )}
                  >
                    {`${log.workflow_run.elapsed_time.toFixed(3)}s`}
                  </div>
                </td>
                <td className="p-3 pr-2">{log.workflow_run.total_tokens}</td>
                <td className="p-3 pr-2">
                  <div className={cn(endUser === defaultValue ? 'text-text-quaternary' : 'text-text-secondary', 'overflow-hidden text-ellipsis whitespace-nowrap')}>
                    {endUser}
                  </div>
                </td>
                {isWorkflow && (
                  <td className="p-3 pr-2">
                    <TriggerByDisplay triggeredFrom={log.workflow_run.triggered_from as WorkflowRunTriggeredFrom} triggerMetadata={log.details?.trigger_metadata} />
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      <Drawer
        isOpen={showDrawer}
        onClose={onCloseDrawer}
        mask={isMobile}
        footer={null}
        panelClassName="mt-16 mx-2 sm:mr-2 mb-3 !p-0 !max-w-[600px] rounded-xl border border-components-panel-border"
      >
        <DetailPanel
          onClose={onCloseDrawer}
          runID={currentLog?.workflow_run.id || ''}
          canReplay={currentLog?.workflow_run.triggered_from === 'app-run' || currentLog?.workflow_run.triggered_from === 'debugging'}
        />
      </Drawer>
    </div>
  )
}

export default WorkflowAppLogList
