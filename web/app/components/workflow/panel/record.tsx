import type { WorkflowRunDetailResponse } from '@/models/log'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import { useRerunEditor, useWorkflowUpdate } from '../hooks'
import { useHooksStore } from '../hooks-store'
import Run from '../run'
import { useStore } from '../store'
import { formatWorkflowRunIdentifier } from '../utils'

const Record = () => {
  const { t } = useTranslation()
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const { handleOpenRerunEditor } = useRerunEditor()
  const getWorkflowRunAndTraceUrl = useHooksStore(s => s.getWorkflowRunAndTraceUrl)
  const currentRunId = historyWorkflowData?.id
  const rerunSourceWorkflowRun = historyWorkflowData?.rerun_source_workflow_run
  const [comparePanelRunId, setComparePanelRunId] = useState<string | null>(null)
  const isRerunRun = !!(
    historyWorkflowData?.rerun_from_workflow_run_id
    || historyWorkflowData?.rerun_chain_root_workflow_run_id
    || historyWorkflowData?.rerun_kind
    || historyWorkflowData?.rerun_from_node_id
  )

  const sourceLabel = useMemo(() => {
    if (!rerunSourceWorkflowRun)
      return ''

    const sourceStatusFallback = rerunSourceWorkflowRun.status?.replace(/-/g, ' ') || 'Running'
    return `Test Run${formatWorkflowRunIdentifier(rerunSourceWorkflowRun.finished_at, sourceStatusFallback)}`
  }, [rerunSourceWorkflowRun])
  const sourceNodeLabel = historyWorkflowData?.rerun_from_node_title || historyWorkflowData?.rerun_from_node_id || ''
  const canCompare = !!rerunSourceWorkflowRun?.id && !!sourceLabel && !!sourceNodeLabel
  const showComparePanel = canCompare && !!currentRunId && comparePanelRunId === currentRunId
  const shouldShowRerunLineText = isRerunRun && canCompare
  const rerunSourceLineText = canCompare
    ? t('debug.rerun.sourceLine', {
        ns: 'workflow',
        source: sourceLabel,
        node: sourceNodeLabel,
      })
    : ''

  const handleResultCallback = useCallback((res: WorkflowRunDetailResponse) => {
    const graph = res.graph
    handleUpdateWorkflowCanvas({
      nodes: graph.nodes,
      edges: graph.edges,
      viewport: graph.viewport || { x: 0, y: 0, zoom: 1 },
    })
  }, [handleUpdateWorkflowCanvas])

  const sourceRunDetailAndTraceUrl = getWorkflowRunAndTraceUrl(rerunSourceWorkflowRun?.id)
  const currentRunDetailAndTraceUrl = getWorkflowRunAndTraceUrl(historyWorkflowData?.id)

  return (
    <div className="flex h-full">
      {canCompare && showComparePanel && (
        <div className="flex h-full w-[400px] flex-col rounded-l-2xl border-[0.5px] border-r-0 border-components-panel-border bg-components-panel-bg shadow-xl">
          <div className="flex items-center justify-between p-4 pb-0 text-text-primary system-xl-semibold">
            {sourceLabel}
            <button
              type="button"
              className="ml-2 cursor-pointer p-1"
              onClick={() => setComparePanelRunId(null)}
            >
              <span className="i-ri-close-line h-4 w-4 text-text-tertiary" />
            </button>
          </div>
          {isRerunRun && <div className="h-6" />}
          <Run
            runDetailUrl={sourceRunDetailAndTraceUrl.runUrl}
            tracingListUrl={sourceRunDetailAndTraceUrl.traceUrl}
            rerunEntryScope="readonly"
          />
        </div>
      )}
      <div
        className={cn(
          'flex h-full w-[400px] flex-col border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl',
          canCompare && showComparePanel ? 'rounded-none border-l-0' : 'rounded-l-2xl',
        )}
      >
        <div className="flex items-center justify-between p-4 pb-0 text-text-primary system-xl-semibold">
          {`Test Run${formatWorkflowRunIdentifier(historyWorkflowData?.finished_at)}`}
        </div>
        {isRerunRun && (
          <div className="h-6 px-4 pt-1">
            {shouldShowRerunLineText && (
              <button
                type="button"
                className={cn(
                  'w-full text-left text-text-tertiary system-xs-medium',
                  showComparePanel
                    ? 'cursor-default'
                    : 'transition-colors hover:text-text-secondary',
                )}
                onClick={() => {
                  if (!showComparePanel && currentRunId)
                    setComparePanelRunId(currentRunId)
                }}
              >
                {rerunSourceLineText}
              </button>
            )}
          </div>
        )}
        <Run
          runDetailUrl={currentRunDetailAndTraceUrl.runUrl}
          tracingListUrl={currentRunDetailAndTraceUrl.traceUrl}
          getResultCallback={handleResultCallback}
          rerunEntryScope="workflow-editor"
          onOpenRerunEditor={handleOpenRerunEditor}
        />
      </div>
    </div>
  )
}

export default memo(Record)
