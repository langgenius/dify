import WorkflowWithDefaultContext, {
  WorkflowWithInnerContext,
} from '@/app/components/workflow'
import Panel from '@/app/components/workflow/panel'
import {
  WorkflowContextProvider,
} from '@/app/components/workflow/context'
import RagPipelineHeader from './components/rag-pipeline-header'

const RagPipeline = () => {
  return (
    <WorkflowContextProvider>
      <WorkflowWithDefaultContext
        edges={[]}
        nodes={[]}
      >
        <WorkflowWithInnerContext
          nodes={[]}
          edges={[]}
        >
          <RagPipelineHeader />
          <Panel />
        </WorkflowWithInnerContext>
      </WorkflowWithDefaultContext>
    </WorkflowContextProvider>
  )
}

export default RagPipeline
