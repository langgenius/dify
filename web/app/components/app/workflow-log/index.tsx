'use client'
import type { FC } from 'react'
import type { WorkflowAppLogDetail } from '@/models/log'
import type { App } from '@/types/app'
import { useDebounce } from 'ahooks'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { omit } from 'es-toolkit/object'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import EmptyElement from '@/app/components/app/log/empty-element'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import Modal from '@/app/components/base/modal'
import Pagination from '@/app/components/base/pagination'
import Toast from '@/app/components/base/toast'
import { Plan } from '@/app/components/billing/type'
import { APP_PAGE_LIMIT } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import {
  useCreateWorkflowRunExportTask,
  useWorkflowArchivedLogs,
  useWorkflowLogs,
  useWorkflowRunExportTaskStatus,
} from '@/service/use-log'
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
  const { userProfile: { timezone }, isCurrentWorkspaceManager } = useAppContext()
  const { plan } = useProviderContext()
  const isFreePlan = plan.type === Plan.sandbox
  const isTeamOrProfessional = plan.type === Plan.team || plan.type === Plan.professional
  const periodKeys = isFreePlan
    ? ['1', '2', '3']
    : isTeamOrProfessional
      ? ['1', '2', '3', '4']
      : Object.keys(TIME_PERIOD_MAPPING)
  const clearPeriod = isFreePlan ? '3' : (isTeamOrProfessional ? '4' : '9')
  const [queryParams, setQueryParams] = useState<QueryParam>({ status: 'all', period: '2' })
  const [currPage, setCurrPage] = React.useState<number>(0)
  const debouncedQueryParams = useDebounce(queryParams, { wait: 500 })
  const [limit, setLimit] = React.useState<number>(APP_PAGE_LIMIT)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [showArchivedModal, setShowArchivedModal] = useState(false)
  const [archivedPage, setArchivedPage] = React.useState<number>(0)
  const [archivedLimit, setArchivedLimit] = React.useState<number>(APP_PAGE_LIMIT)
  const [exportingRunId, setExportingRunId] = useState<string | null>(null)
  const [exportTaskId, setExportTaskId] = useState<string | null>(null)
  const exportPollAttemptsRef = useRef(0)
  const createExportTask = useCreateWorkflowRunExportTask()
  const exportTaskStatus = useWorkflowRunExportTaskStatus(exportTaskId || '', !!exportTaskId)

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

  const archivedQuery = {
    page: archivedPage + 1,
    detail: true,
    limit: archivedLimit,
  }

  const { data: archivedLogs, isLoading: archivedLoading, refetch: refetchArchived } = useWorkflowArchivedLogs({
    appId: appDetail.id,
    params: archivedQuery,
  })
  const archivedTotal = archivedLogs?.total

  useEffect(() => {
    exportPollAttemptsRef.current = 0
  }, [exportTaskId])

  useEffect(() => {
    // Handle terminal export task outcomes (success or failure).
    if (!exportTaskStatus.data || !exportingRunId)
      return

    const { status, presigned_url: presignedUrl } = exportTaskStatus.data
    if (status === 'success' && presignedUrl) {
      window.open(presignedUrl, '_blank')
      setExportingRunId(null)
      setExportTaskId(null)
    }
    else if (status === 'failed') {
      Toast.notify({
        type: 'error',
        message: t('filter.archived.exportFailed', { ns: 'appLog' }),
      })
      setExportingRunId(null)
      setExportTaskId(null)
    }
  }, [exportTaskStatus.data, exportingRunId])

  useEffect(() => {
    // Guard against polling forever by failing after a few refetches.
    if (!exportTaskId)
      return
    const status = exportTaskStatus.data?.status
    if (status === 'success' || status === 'failed')
      return

    if (exportTaskStatus.dataUpdatedAt) {
      exportPollAttemptsRef.current += 1
      const MAX_ATTEMPTS = 5
      if (exportPollAttemptsRef.current >= MAX_ATTEMPTS) {
        Toast.notify({
          type: 'error',
          message: t('filter.archived.exportFailed', { ns: 'appLog' }),
        })
        setExportingRunId(null)
        setExportTaskId(null)
      }
    }
  }, [exportTaskStatus.dataUpdatedAt, exportTaskStatus.data?.status, exportTaskId])

  const handleExport = useCallback(
    async (log: WorkflowAppLogDetail) => {
      if (exportingRunId || exportTaskId)
        return
      const runId = log.workflow_run.id
      setExportingRunId(runId)
      try {
        const task = await createExportTask.mutateAsync({ appId: appDetail.id, runId })
        if (task.status === 'success' && task.presigned_url) {
          window.open(task.presigned_url, '_blank')
          setExportingRunId(null)
          setExportTaskId(null)
          return
        }
        setExportTaskId(task.task_id)
      }
      catch (e) {
        Toast.notify({
          type: 'error',
          message: t('filter.archived.exportFailed', { ns: 'appLog' }),
        })
        setExportingRunId(null)
        setExportTaskId(null)
      }
    },
    [appDetail.id, createExportTask, exportTaskId, exportingRunId, t],
  )

  return (
    <div className="flex h-full flex-col">
      <h1 className="system-xl-semibold text-text-primary">{t('workflowTitle', { ns: 'appLog' })}</h1>
      <p className="system-sm-regular text-text-tertiary">{t('workflowSubtitle', { ns: 'appLog' })}</p>
      <div className="flex max-h-[calc(100%-16px)] flex-1 flex-col py-4">
        <Filter
          queryParams={queryParams}
          setQueryParams={setQueryParams}
          periodKeys={periodKeys}
          clearPeriod={clearPeriod}
          isCurrentWorkspaceManager={isCurrentWorkspaceManager}
          isFreePlan={isFreePlan}
          isTeamOrProfessional={isTeamOrProfessional}
          onArchivedClick={() => {
            if (isFreePlan) {
              setShowUpgradeModal(true)
              return
            }
            if (isTeamOrProfessional) {
              setArchivedPage(0)
              setShowArchivedModal(true)
              refetchArchived()
            }
          }}
        />
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

      <Modal
        isShow={showUpgradeModal}
        title={t('filter.archived.upgrade.title', { ns: 'appLog' })}
        description={t('filter.archived.upgrade.description', { ns: 'appLog' })}
        onClose={() => setShowUpgradeModal(false)}
        closable
      >
        <div className="mt-6 flex justify-end">
          <Button size="small" onClick={() => setShowUpgradeModal(false)}>
            {t('operation.close', { ns: 'common' })}
          </Button>
        </div>
      </Modal>

      {/* Export archived logs modal */}
      <Modal
        isShow={showArchivedModal}
        title={t('filter.archived.list.title', { ns: 'appLog' })}
        description={t('filter.archived.list.description', { ns: 'appLog' })}
        onClose={() => setShowArchivedModal(false)}
        closable
        containerClassName="!items-start"
        className="max-w-[960px]"
      >
        <div className="mt-4 flex flex-col gap-3">
          {archivedLoading
            ? (
                <div className="flex justify-center py-10">
                  <Loading type="app" />
                </div>
              )
            : archivedTotal && archivedTotal > 0
              ? (
                  <>
                    <List
                      logs={archivedLogs}
                      appDetail={appDetail}
                      onRefresh={refetchArchived}
                      disableInteraction
                      showExportColumn
                      exportLoadingRunId={exportingRunId || undefined}
                      onExport={handleExport}
                    />
                    {(archivedTotal && archivedTotal > APP_PAGE_LIMIT)
                      ? (
                          <Pagination
                            current={archivedPage}
                            onChange={setArchivedPage}
                            total={archivedTotal}
                            limit={archivedLimit}
                            onLimitChange={setArchivedLimit}
                          />
                        )
                      : null}
                  </>
                )
              : (
                  <div className="py-6 text-center text-sm text-text-tertiary">{t('table.empty.noChat', { ns: 'appLog' })}</div>
                )}
        </div>
      </Modal>
    </div>
  )
}

export default Logs
