import type { EvaluationResourceProps } from '../../types'
import type { EvaluationLog, EvaluationRunStatus } from '@/types/evaluation'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Pagination from '@/app/components/base/pagination'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleClient, consoleQuery } from '@/service/client'
import { useMembers } from '@/service/use-common'
import { downloadUrl } from '@/utils/download'
import { useEvaluationResource, useEvaluationStore } from '../../store'

const PAGE_SIZE = 16
const LOADING_ROW_IDS = ['1', '2', '3', '4', '5', '6']
const CREATED_AT_FORMAT = 'YYYY-MM-DD'

type FormatTimestamp = (value: number, format: string) => string

const STATUS_ICON_CLASS_NAMES: Record<EvaluationRunStatus, string> = {
  pending: 'i-ri-time-line text-text-tertiary',
  running: 'i-ri-loader-4-line animate-spin text-text-accent',
  completed: 'i-ri-checkbox-circle-fill text-util-colors-green-green-600',
  failed: 'i-ri-close-circle-fill text-text-destructive',
  cancelled: 'i-ri-forbid-2-line text-text-tertiary',
}

const formatCreatedAt = (createdAt: number | null | undefined, formatTime: FormatTimestamp) => {
  if (createdAt == null)
    return '-'

  return formatTime(createdAt, CREATED_AT_FORMAT)
}

const getLogRunId = (record: EvaluationLog) => {
  return record.id
}

const HistoryTab = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const { formatTime } = useTimestamp()
  const { data: membersData } = useMembers()
  const [page, setPage] = useState(0)
  const resource = useEvaluationResource(resourceType, resourceId)
  const setSelectedRunId = useEvaluationStore(state => state.setSelectedRunId)
  const logsQuery = useQuery({
    ...consoleQuery.evaluation.logs.queryOptions({
      input: {
        params: {
          targetType: resourceType,
          targetId: resourceId,
        },
        query: {
          page: page + 1,
          page_size: PAGE_SIZE,
        },
      },
      refetchOnWindowFocus: false,
    }),
    placeholderData: keepPreviousData,
  })
  const fileDownloadMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const fileInfo = await consoleClient.evaluation.file({
        params: {
          targetType: resourceType,
          targetId: resourceId,
          fileId,
        },
      })

      downloadUrl({ url: fileInfo.download_url, fileName: fileInfo.name })
    },
  })
  const records = useMemo(() => logsQuery.data?.data ?? [], [logsQuery.data?.data])
  const memberNameById = useMemo(() => {
    return new Map((membersData?.accounts ?? []).map(member => [member.id, member.name]))
  }, [membersData?.accounts])
  const total = logsQuery.data?.total ?? 0
  const isInitialLoading = logsQuery.isLoading && !logsQuery.data

  useEffect(() => {
    if (resource.selectedRunId)
      return

    const firstRunId = records.map(getLogRunId).find((runId): runId is string => !!runId)
    if (firstRunId)
      setSelectedRunId(resourceType, resourceId, firstRunId)
  }, [records, resource.selectedRunId, resourceId, resourceType, setSelectedRunId])

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
                  {t('history.columns.time')}
                  <span aria-hidden="true" className="i-ri-arrow-down-line h-3.5 w-3.5" />
                </span>
              </th>
              <th className="h-7 px-3 text-left system-xs-medium-uppercase text-text-tertiary">{t('history.columns.creator')}</th>
              <th className="h-7 px-3 text-left system-xs-medium-uppercase text-text-tertiary">{t('history.columns.status')}</th>
              <th className="h-7 text-center text-text-tertiary">
                <span aria-hidden="true" className="i-ri-download-2-line inline-block h-3.5 w-3.5" />
              </th>
            </tr>
          </thead>
          <tbody>
            {isInitialLoading && LOADING_ROW_IDS.map(rowId => (
              <tr key={rowId} className="border-b border-divider-subtle">
                <td colSpan={4} className="h-10 px-3">
                  <div className="h-4 animate-pulse rounded bg-background-section" />
                </td>
              </tr>
            ))}
            {!isInitialLoading && records.map(record => (
              <tr
                key={record.id}
                className={cn(
                  'border-b border-divider-subtle',
                  getLogRunId(record) && 'cursor-pointer hover:bg-state-base-hover',
                  getLogRunId(record) === resource.selectedRunId && 'bg-background-default-subtle',
                )}
                onClick={() => {
                  const runId = getLogRunId(record)
                  if (runId)
                    setSelectedRunId(resourceType, resourceId, runId)
                }}
              >
                <td className="h-10 truncate px-3 system-sm-regular text-text-secondary">{formatCreatedAt(record.created_at, formatTime)}</td>
                <td className="h-10 truncate px-3 system-sm-regular text-text-secondary">{memberNameById.get(record.created_by) ?? record.created_by}</td>
                <td className="h-10 px-3">
                  <div className="flex h-10 items-center justify-center">
                    <span aria-label={t(`history.status.${record.status}`)} className={cn('inline-block h-4 w-4', STATUS_ICON_CLASS_NAMES[record.status])} />
                  </div>
                </td>
                <td className="h-10 text-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={(
                        <button
                          type="button"
                          aria-label={t('history.actions.open')}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
                          onClick={event => event.stopPropagation()}
                        />
                      )}
                    >
                      <span aria-hidden="true" className="i-ri-more-2-fill h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent popupClassName="w-[180px] rounded-lg border-[0.5px] border-components-panel-border py-1 shadow-lg">
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
                        {t('history.actions.downloadTestFile')}
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
                        {t('history.actions.downloadResultFile')}
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
            {t('history.empty')}
          </div>
        )}
      </div>
      {total > PAGE_SIZE && (
        <Pagination
          className="px-0 py-3"
          current={page}
          limit={PAGE_SIZE}
          total={total}
          onChange={setPage}
        />
      )}
    </div>
  )
}

export default HistoryTab
