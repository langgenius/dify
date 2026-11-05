'use client'

import type { EvaluationResourceProps } from '../../types'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadUrl } from '@/utils/download'
import { getEvaluationFile, useEvaluationRunDetailQuery } from '../../queries'
import { useEvaluationResource } from '../../store'
import { decodeModelSelection } from '../../utils'
import PipelineResultsTable from './pipeline-results-table'
import { getMetricColumns, getRunDate } from './pipeline-results-utils'

const PAGE_SIZE = 100

type PipelineResultsPreviewProps = EvaluationResourceProps & {
  runId: string
}

const PipelineResultsPreview = ({
  resourceType,
  resourceId,
  runId,
}: PipelineResultsPreviewProps) => {
  const { t } = useTranslation(['evaluation'])
  const [page, setPage] = useState(1)
  const resource = useEvaluationResource(resourceType, resourceId)
  const selectedModel = decodeModelSelection(resource.judgeModelId)
  const runDetailQuery = useEvaluationRunDetailQuery(
    { resourceType, resourceId },
    { runId, page, pageSize: PAGE_SIZE },
  )
  const resultFileDownloadMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const fileInfo = await getEvaluationFile({ resourceType, resourceId }, fileId)
      downloadUrl({ url: fileInfo.download_url, fileName: fileInfo.name })
    },
  })
  const runDetail =
    runDetailQuery.data?.run.id === runId && runDetailQuery.data.items.page === page
      ? runDetailQuery.data
      : undefined
  const items = runDetail?.items.data ?? []
  const metricColumns = getMetricColumns(resource, items)
  const isLoading = runDetailQuery.isPending || (!runDetail && runDetailQuery.isFetching)
  const totalPages = Math.ceil((runDetail?.items.total ?? 0) / PAGE_SIZE)

  if (runDetailQuery.isError) {
    return (
      <div className="py-4 system-sm-regular text-text-destructive">
        {t(($) => $['results.loadFailed'])}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 py-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2 system-xs-regular text-text-secondary">
          <span>{getRunDate(runDetail?.run.started_at ?? runDetail?.run.created_at ?? null)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {t(($) => $['results.queryCount'], {
              count: runDetail?.run.total_items ?? runDetail?.items.total ?? items.length,
            })}
          </span>
          {selectedModel && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-background-section-burn px-2 py-1">
                <span
                  aria-hidden="true"
                  className="i-ri-robot-2-line h-4 w-4 shrink-0 text-text-accent"
                />
                <span className="truncate">{selectedModel.model}</span>
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-2 system-xs-medium text-components-button-secondary-text shadow-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-accent disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!runDetail?.run.result_file_id || resultFileDownloadMutation.isPending}
          onClick={() => {
            if (runDetail?.run.result_file_id)
              resultFileDownloadMutation.mutate(runDetail.run.result_file_id)
          }}
        >
          <span aria-hidden="true" className="i-ri-download-2-line h-3.5 w-3.5" />
          {t(($) => $['results.export'])}
        </button>
      </div>

      {!isLoading && items.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center system-md-medium text-text-quaternary">
          {t(($) => $['results.empty'])}
        </div>
      ) : (
        <PipelineResultsTable items={items} metricColumns={metricColumns} isLoading={isLoading} />
      )}

      {totalPages > 1 && (
        <Pagination
          className="shrink-0 px-0 py-3"
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}

export default PipelineResultsPreview
