import WorkflowWithDefaultContext from '@/app/components/workflow'
import {
  WorkflowContextProvider,
} from '@/app/components/workflow/context'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import { generateNewNode } from '@/app/components/workflow/utils'
import knowledgeBaseNodeDefault from '@/app/components/workflow/nodes/knowledge-base/default'
import {
  NODE_WIDTH_X_OFFSET,
  START_INITIAL_POSITION,
} from '@/app/components/workflow/constants'
import { createRagPipelineSliceSlice } from './store'
import RagPipelineMain from './components/rag-pipeline-main'

const RagPipeline = () => {
  const { newNode: knowledgeBaseNode } = generateNewNode({
    data: {
      type: knowledgeBaseNodeDefault.metaData.type,
      title: 'knowledge-base',
      ...knowledgeBaseNodeDefault.defaultValue,
    },
    position: {
      x: START_INITIAL_POSITION.x + NODE_WIDTH_X_OFFSET,
      y: START_INITIAL_POSITION.y,
    },
  } as any)
  return (
    <WorkflowContextProvider
      injectWorkflowStoreSliceFn={createRagPipelineSliceSlice as InjectWorkflowStoreSliceFn}
    >
      <WorkflowWithDefaultContext
        edges={[]}
        nodes={[knowledgeBaseNode]}
      >
        <RagPipelineMain
          edges={[]}
          nodes={[knowledgeBaseNode]}
        />
      </WorkflowWithDefaultContext>
    </WorkflowContextProvider>
  )
}

export default RagPipeline
