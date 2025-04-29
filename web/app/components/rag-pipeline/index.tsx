import WorkflowWithDefaultContext from '@/app/components/workflow'
import {
  WorkflowContextProvider,
} from '@/app/components/workflow/context'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import { generateNewNode } from '@/app/components/workflow/utils'
import dataSourceNodeDefault from '@/app/components/workflow/nodes/data-source/default'
import {
  NODE_WIDTH_X_OFFSET,
  START_INITIAL_POSITION,
} from '@/app/components/workflow/constants'
import { createRagPipelineSliceSlice } from './store'
import RagPipelineMain from './components/rag-pipeline-main'

const RagPipeline = () => {
  const { newNode: DataSourceNode } = generateNewNode({
    data: {
      type: dataSourceNodeDefault.metaData.type,
      title: 'data-source',
      ...dataSourceNodeDefault.defaultValue,
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
        nodes={[DataSourceNode]}
      >
        <RagPipelineMain
          edges={[]}
          nodes={[DataSourceNode]}
        />
      </WorkflowWithDefaultContext>
    </WorkflowContextProvider>
  )
}

export default RagPipeline
