import { memo, useCallback } from 'react'
import {
  useIsChatMode,
  useWorkflow,
} from '../hooks'
import Run from '../run'
import { useStore } from '../store'
import ChatRecord from './chat-record'
import type { WorkflowRunDetailResponse } from '@/models/log'

const Record = () => {
  const isChatMode = useIsChatMode()
  const { renderTreeFromRecord } = useWorkflow()
  const historyWorkflowData = useStore(s => s.historyWorkflowData)

  const getResultCallback = useCallback((res: WorkflowRunDetailResponse) => {
    const { graph } = res

    renderTreeFromRecord(graph.nodes, graph.edges, graph.viewport)
  }, [renderTreeFromRecord])

  return (
    <div className={`
      flex flex-col h-full rounded-2xl border-[0.5px] border-gray-200 shadow-xl bg-white
      ${isChatMode ? 'w-[320px]' : 'w-[400px]'}
    `}>
      <div className='flex items-center justify-between p-4 pb-1 text-base font-semibold text-gray-900'>
        {`Test ${isChatMode ? 'Chat' : 'Run'}#${historyWorkflowData?.sequence_number}`}
      </div>
      {
        isChatMode
          ? <ChatRecord />
          : (
            <Run
              runID={historyWorkflowData?.id || ''}
              getResultCallback={getResultCallback}
            />
          )
      }
    </div>
  )
}

export default memo(Record)
