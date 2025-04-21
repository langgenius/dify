import WorkflowWithDefaultContext, {
  WorkflowWithInnerContext,
} from '@/app/components/workflow'
import RagPipelinePanel from './components/panel'
import {
  WorkflowContextProvider,
} from '@/app/components/workflow/context'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import RagPipelineHeader from './components/rag-pipeline-header'
import { createRagPipelineSliceSlice } from './store'

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
          <RagPipelineHeader />
          <RagPipelinePanel />
        </WorkflowWithInnerContext>
      </WorkflowWithDefaultContext>
    </WorkflowContextProvider>
  )
}

export default RagPipeline
