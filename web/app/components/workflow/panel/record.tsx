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
    <div className='flex flex-col w-[400px] h-full rounded-l-2xl border-[0.5px] border-components-panel-border shadow-xl bg-components-panel-bg'>
      <div className='flex items-center justify-between p-4 pb-0 text-text-primary system-xl-semibold'>
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
