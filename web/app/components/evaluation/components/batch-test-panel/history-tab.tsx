import type { EvaluationRunResponse } from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import type { EvaluationResourceProps } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/console'
import { downloadUrl } from '@/utils/download'
import { getEvaluationFile, useEvaluationActions, useEvaluationLogsQuery } from '../../queries'
import { useEvaluationResource, useEvaluationStore } from '../../store'

const PAGE_SIZE = 16
const LOADING_ROW_IDS = ['1', '2', '3', '4', '5', '6']
const CREATED_AT_FORMAT = 'YYYY-MM-DD'

type FormatTimestamp = (value: number, format: string) => string

const STATUS_ICON_CLASS_NAMES: Record<string, string> = {
  pending: 'i-ri-time-line text-text-tertiary',
  running: 'i-ri-loader-4-line animate-spin text-text-accent',
  completed: 'i-ri-checkbox-circle-fill text-util-colors-green-green-600',
  failed: 'i-ri-close-circle-fill text-text-destructive',
  cancelled: 'i-ri-forbid-2-line text-text-tertiary',
}

const formatCreatedAt = (createdAt: number | null | undefined, formatTime: FormatTimestamp) => {
  if (createdAt == null) return '-'

  return formatTime(createdAt, CREATED_AT_FORMAT)
}

const HistoryTab = ({ resourceType, resourceId }: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const { formatTime } = useTimestamp()
  const { data: membersData } = useQuery(
    consoleQuery.workspaces.current.members.get.queryOptions({ input: {} }),
  )
  const [page, setPage] = useState(0)
  const resource = useEvaluationResource(resourceType, resourceId)
  const setSelectedRunId = useEvaluationStore((state) => state.setSelectedRunId)
  const logsQuery = useEvaluationLogsQuery(
    { resourceType, resourceId },
    { page: page + 1, pageSize: PAGE_SIZE },
  )
  const evaluationActions = useEvaluationActions({ resourceType, resourceId })
  const fileDownloadMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const fileInfo = await getEvaluationFile({ resourceType, resourceId }, fileId)
      downloadUrl({ url: fileInfo.download_url, fileName: fileInfo.name })
    },
    onError: () => toast.error(t(($) => $['history.actions.downloadFailed'])),
  })
  const records = useMemo(() => logsQuery.data?.data ?? [], [logsQuery.data?.data])
  const memberNameById = useMemo(() => {
    return new Map((membersData?.accounts ?? []).map((member) => [member.id, member.name]))
  }, [membersData?.accounts])
  const statusLabels: Record<string, string> = {
    pending: t(($) => $['history.status.pending']),
    running: t(($) => $['history.status.running']),
    completed: t(($) => $['history.status.completed']),
    failed: t(($) => $['history.status.failed']),
    cancelled: t(($) => $['history.status.cancelled']),
  }
  const total = logsQuery.data?.total ?? 0
  const isInitialLoading = logsQuery.isLoading && !logsQuery.data

  useEffect(() => {
    if (resource.selectedRunId) return

    const firstRunId = records[0]?.id
    if (firstRunId) setSelectedRunId(resourceType, resourceId, firstRunId)
  }, [records, resource.selectedRunId, resourceId, resourceType, setSelectedRunId])

  const handleCancel = async (record: EvaluationRunResponse) => {
    try {
      await evaluationActions.cancelRun(record.id)
      toast.success(t(($) => $['history.cancelSuccess']))
    } catch {
      toast.error(t(($) => $['history.cancelFailed']))
    }
  }

  const handleRetry = async (record: EvaluationRunResponse) => {
    try {
      await evaluationActions.retryRun(record.id)
      setSelectedRunId(resourceType, resourceId, record.id)
      toast.success(t(($) => $['history.retrySuccess']))
    } catch {
      toast.error(t(($) => $['history.retryFailed']))
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <table className="w-full table-fixed border-collapse overflow-hidden rounded-md">
          <colgroup>
            <col className="w-[120px]" />
            <col className="w-[120px]" />
            <col className="w-[67px]" />
            <col className="w-[40px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-divider-regular">
              <th className="h-7 px-3 text-left system-xs-medium-uppercase text-text-tertiary">
                <span className="inline-flex items-center gap-0.5">
                  {t(($) => $['history.columns.time'])}
                  <span aria-hidden="true" className="i-ri-arrow-down-line h-3.5 w-3.5" />
                </span>
              </th>
              <th className="h-7 px-3 text-left system-xs-medium-uppercase text-text-tertiary">
                {t(($) => $['history.columns.creator'])}
              </th>
              <th className="h-7 px-3 text-left system-xs-medium-uppercase text-text-tertiary">
                {t(($) => $['history.columns.status'])}
              </th>
              <th className="h-7 text-center text-text-tertiary">
                <span aria-hidden="true" className="i-ri-more-2-fill inline-block h-3.5 w-3.5" />
              </th>
            </tr>
          </thead>
          <tbody>
            {isInitialLoading &&
              LOADING_ROW_IDS.map((rowId) => (
                <tr key={rowId} className="border-b border-divider-subtle">
                  <td colSpan={4} className="h-10 px-3">
                    <div className="h-4 animate-pulse rounded bg-background-section" />
                  </td>
                </tr>
              ))}
            {!isInitialLoading &&
              records.map((record) => (
                <tr
                  key={record.id}
                  className={cn(
                    'cursor-pointer border-b border-divider-subtle hover:bg-state-base-hover',
                    record.id === resource.selectedRunId && 'bg-background-default-subtle',
                  )}
                  onClick={() => setSelectedRunId(resourceType, resourceId, record.id)}
                >
                  <td className="h-10 truncate px-3 system-sm-regular text-text-secondary">
                    {formatCreatedAt(record.created_at, formatTime)}
                  </td>
                  <td className="h-10 truncate px-3 system-sm-regular text-text-secondary">
                    {memberNameById.get(record.created_by) ?? record.created_by}
                  </td>
                  <td className="h-10 px-3">
                    <div className="flex h-10 items-center justify-center">
                      <span
                        aria-label={statusLabels[record.status] ?? record.status}
                        className={cn(
                          'inline-block h-4 w-4',
                          STATUS_ICON_CLASS_NAMES[record.status] ?? STATUS_ICON_CLASS_NAMES.pending,
                        )}
                      />
                    </div>
                  </td>
                  <td className="h-10 text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <button
                            type="button"
                            aria-label={t(($) => $['history.actions.open'])}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
                            onClick={(event) => event.stopPropagation()}
                          />
                        }
                      >
                        <span aria-hidden="true" className="i-ri-more-2-fill h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-[180px] rounded-lg border-[0.5px] border-components-panel-border py-1 shadow-lg">
                        {(record.status === 'pending' || record.status === 'running') && (
                          <DropdownMenuItem
                            className="gap-2"
                            disabled={evaluationActions.isCancelling}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleCancel(record)
                            }}
                          >
                            <span aria-hidden="true" className="i-ri-stop-circle-line h-4 w-4" />
                            {t(($) => $['history.actions.cancel'])}
                          </DropdownMenuItem>
                        )}
                        {record.status === 'failed' && (
                          <DropdownMenuItem
                            className="gap-2"
                            disabled={evaluationActions.isRetrying}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleRetry(record)
                            }}
                          >
                            <span aria-hidden="true" className="i-ri-restart-line h-4 w-4" />
                            {t(($) => $['history.actions.retry'])}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="gap-2"
                          disabled={!record.dataset_file_id}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (record.dataset_file_id)
                              fileDownloadMutation.mutate(record.dataset_file_id)
                          }}
                        >
                          <span aria-hidden="true" className="i-ri-file-download-line h-4 w-4" />
                          {t(($) => $['history.actions.downloadTestFile'])}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2"
                          disabled={!record.result_file_id}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (record.result_file_id)
                              fileDownloadMutation.mutate(record.result_file_id)
                          }}
                        >
                          <span aria-hidden="true" className="i-ri-download-2-line h-4 w-4" />
                          {t(($) => $['history.actions.downloadResultFile'])}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!isInitialLoading && records.length === 0 && (
          <div className="mt-4 rounded-2xl border border-dashed border-divider-subtle px-4 py-10 text-center system-sm-regular text-text-tertiary">
            {t(($) => $['history.empty'])}
          </div>
        )}
      </div>
      {total > PAGE_SIZE && (
        <Pagination
          className="px-0 py-3"
          page={page + 1}
          totalPages={Math.ceil(total / PAGE_SIZE)}
          onPageChange={(nextPage) => setPage(nextPage - 1)}
        />
      )}
    </div>
  )
}

export default HistoryTab
