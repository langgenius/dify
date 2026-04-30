'use client'

import type { EvaluationResourceProps } from '../../types'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleClient, consoleQuery } from '@/service/client'
import { downloadUrl } from '@/utils/download'
import { useEvaluationResource } from '../../store'
import { decodeModelSelection } from '../../utils'
import PipelineResultsTable from './pipeline-results-table'
import { getMetricColumns, getRunDate } from './pipeline-results-utils'

const PAGE_SIZE = 100

const PipelineResultsPanel = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const selectedModel = decodeModelSelection(resource.judgeModelId)
  const selectedRunId = resource.selectedRunId
  const runDetailQuery = useQuery(consoleQuery.evaluation.runDetail.queryOptions({
    input: selectedRunId
      ? {
          params: {
            targetType: resourceType,
            targetId: resourceId,
            runId: selectedRunId,
          },
          query: {
            page: 1,
            page_size: PAGE_SIZE,
          },
        }
      : skipToken,
    refetchOnWindowFocus: false,
  }))
  const resultFileDownloadMutation = useMutation({
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
  const runDetail = runDetailQuery.data
  const items = runDetail?.items.data ?? []
  const metricColumns = getMetricColumns(resource, items)
  const thresholdColumns = metricColumns.filter(column => column.threshold !== undefined)
  const isEmpty = !selectedRunId || (!runDetailQuery.isLoading && items.length === 0)

  if (isEmpty) {
    return (
      <div className="flex min-h-[360px] w-full items-center justify-center xl:h-full xl:min-h-0">
        <div className="flex flex-col items-center gap-4 px-4 text-center">
          <span aria-hidden="true" className="i-ri-file-list-3-line h-12 w-12 text-text-quaternary" />
          <div className="system-md-medium text-text-quaternary">{t('results.empty')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[360px] flex-col border-l border-divider-subtle bg-background-default xl:h-full xl:min-h-0">
      <div className="shrink-0 px-6 pt-4 pb-2">
        <h2 className="system-xl-semibold text-text-primary">{t('results.title')}</h2>
      </div>
      {runDetailQuery.isError && (
        <div className="px-6 py-4 system-sm-regular text-text-destructive">{t('results.loadFailed')}</div>
      )}
      {!runDetailQuery.isError && (
        <div className="flex flex-col px-6 py-1 xl:min-h-0 xl:flex-1">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 py-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2 system-xs-regular text-text-secondary">
              <span>{getRunDate(runDetail?.run.started_at ?? runDetail?.run.created_at ?? null)}</span>
              <span aria-hidden="true">·</span>
              <span>{t('results.queryCount', { count: runDetail?.run.total_items ?? runDetail?.items.total ?? items.length })}</span>
              {selectedModel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-background-section-burn px-2 py-1">
                    <span aria-hidden="true" className="i-ri-robot-2-line h-4 w-4 shrink-0 text-text-accent" />
                    <span className="truncate">{selectedModel.model}</span>
                  </span>
                </>
              )}
              {thresholdColumns.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    {thresholdColumns.map(column => (
                      <span
                        key={column.id}
                        className="rounded-lg border-[0.5px] border-divider-subtle bg-background-section px-2 py-1 text-text-tertiary"
                      >
                        {t('results.metricThreshold', { metric: column.label, threshold: column.threshold })}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </div>
            <button
              type="button"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-2 system-xs-medium text-components-button-secondary-text shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!runDetail?.run.result_file_id || resultFileDownloadMutation.isPending}
              onClick={() => {
                if (runDetail?.run.result_file_id)
                  resultFileDownloadMutation.mutate(runDetail.run.result_file_id)
              }}
            >
              <span aria-hidden="true" className="i-ri-download-2-line h-3.5 w-3.5" />
              {t('results.export')}
            </button>
          </div>

          <PipelineResultsTable
            items={items}
            metricColumns={metricColumns}
            isLoading={runDetailQuery.isLoading}
          />
        </div>
      )}
    </div>
  )
}

export default PipelineResultsPanel
