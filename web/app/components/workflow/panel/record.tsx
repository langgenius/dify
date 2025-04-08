import { memo, useCallback } from 'react'
import type { WorkflowDataUpdater } from '../types'
import Run from '../run'
import { useStore } from '../store'
import { useWorkflowUpdate } from '../hooks'

const Record = () => {
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()

  const handleResultCallback = useCallback((res: any) => {
    const graph: WorkflowDataUpdater = res.graph
    handleUpdateWorkflowCanvas({
      nodes: graph.nodes,
      edges: graph.edges,
      viewport: graph.viewport,
    })
  }, [handleUpdateWorkflowCanvas])

  return (
    <div className='flex h-full w-[400px] flex-col rounded-l-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl'>
      <div className='system-xl-semibold flex items-center justify-between p-4 pb-0 text-text-primary'>
        {`Test Run#${historyWorkflowData?.sequence_number}`}
      </div>
      <Run
        runID={historyWorkflowData?.id || ''}
        getResultCallback={handleResultCallback}
      />
    </div>
  )
}

export default memo(Record)
