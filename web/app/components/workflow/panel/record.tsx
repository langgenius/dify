import type { WorkflowRunDetailResponse } from '@/models/log'
import { useAtomValue } from 'jotai'
import { memo, useCallback } from 'react'
import { editorAppIdAtom, editorResourceAtom } from '../editor-resource/state'
import { useWorkflowUpdate } from '../hooks/use-workflow-update'
import Run from '../run'
import { useStore } from '../store'
import { formatWorkflowRunIdentifier } from '../utils'

const Record = () => {
  const appId = useAtomValue(editorAppIdAtom)
  const historyWorkflowData = useStore((s) => s.historyWorkflowData)
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const editorResource = useAtomValue(editorResourceAtom)

  const handleResultCallback = useCallback(
    (res: WorkflowRunDetailResponse) => {
      const graph = res.graph
      handleUpdateWorkflowCanvas({
        nodes: graph.nodes,
        edges: graph.edges,
        viewport: graph.viewport || { x: 0, y: 0, zoom: 1 },
      })
    },
    [handleUpdateWorkflowCanvas],
  )

  return (
    <div className="flex h-full w-100 flex-col rounded-s-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl">
      <div className="flex items-center justify-between p-4 pb-0 system-xl-semibold text-text-primary">
        {`Test Run${formatWorkflowRunIdentifier(historyWorkflowData?.finished_at, historyWorkflowData?.status)}`}
      </div>
      <Run
        appId={appId}
        runOwner={editorResource}
        runId={historyWorkflowData?.id}
        getResultCallback={handleResultCallback}
      />
    </div>
  )
}

export default memo(Record)
