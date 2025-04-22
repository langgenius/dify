import WorkflowWithDefaultContext, {
  WorkflowWithInnerContext,
} from '@/app/components/workflow'
import {
  WorkflowContextProvider,
} from '@/app/components/workflow/context'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import { createRagPipelineSliceSlice } from './store'
import RagPipelineChildren from './components/rag-pipeline-children'

const RagPipeline = () => {
  return (
    <WorkflowContextProvider
      injectWorkflowStoreSliceFn={createRagPipelineSliceSlice as InjectWorkflowStoreSliceFn}
    >
      <WorkflowWithDefaultContext
        edges={[]}
        nodes={[]}
      >
        <WorkflowWithInnerContext
          nodes={[]}
          edges={[]}
        >
          <RagPipelineChildren />
        </WorkflowWithInnerContext>
      </WorkflowWithDefaultContext>
    </WorkflowContextProvider>
  )
}

export default RagPipeline
