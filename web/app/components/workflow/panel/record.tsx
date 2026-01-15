import type { WorkflowRunDetailResponse } from '@/models/log'
import { memo, useCallback } from 'react'
import { useWorkflowUpdate } from '../hooks'
import { useHooksStore } from '../hooks-store'
import Run from '../run'
import { useStore } from '../store'
import { formatWorkflowRunIdentifier } from '../utils'

const Record = () => {
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const getWorkflowRunAndTraceUrl = useHooksStore(s => s.getWorkflowRunAndTraceUrl)

  const handleResultCallback = useCallback((res: WorkflowRunDetailResponse) => {
    const graph = res.graph
    handleUpdateWorkflowCanvas({
      nodes: graph.nodes,
      edges: graph.edges,
      viewport: graph.viewport || { x: 0, y: 0, zoom: 1 },
    })
  }, [handleUpdateWorkflowCanvas])

  return (
    <div className="flex h-full w-[400px] flex-col rounded-l-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl">
      <div className="system-xl-semibold flex items-center justify-between p-4 pb-0 text-text-primary">
        {`Test Run${formatWorkflowRunIdentifier(historyWorkflowData?.finished_at)}`}
      </div>
      <Run
        runDetailUrl={getWorkflowRunAndTraceUrl(historyWorkflowData?.id).runUrl}
        tracingListUrl={getWorkflowRunAndTraceUrl(historyWorkflowData?.id).traceUrl}
        getResultCallback={handleResultCallback}
      />
    </div>
  )
}

export default memo(Record)
