import { useMemo } from 'react'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import {
  WorkflowContextProvider,
} from '@/app/components/workflow/context'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import {
  initialEdges,
  initialNodes,
} from '@/app/components/workflow/utils'
import Loading from '@/app/components/base/loading'
import { createRagPipelineSliceSlice } from './store'
import RagPipelineMain from './components/rag-pipeline-main'
import { usePipelineInit } from './hooks'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import Conversion from './components/conversion'
import { processNodesWithoutDataSource } from './utils'

const RagPipeline = () => {
  const {
    data,
    isLoading,
  } = usePipelineInit()
  const nodesData = useMemo(() => {
    if (data)
      return initialNodes(data.graph.nodes, data.graph.edges)

    return []
  }, [data])
  const edgesData = useMemo(() => {
    if (data)
      return initialEdges(data.graph.edges, data.graph.nodes)

    return []
  }, [data])

  if (!data || isLoading) {
    return (
      <div className='relative flex h-full w-full items-center justify-center'>
        <Loading />
      </div>
    )
  }

  const {
    nodes: processedNodes,
    viewport,
  } = processNodesWithoutDataSource(nodesData, data.graph.viewport)
  return (
    <WorkflowWithDefaultContext
      edges={edgesData}
      nodes={processedNodes}
    >
      <RagPipelineMain
        edges={edgesData}
        nodes={processedNodes}
        viewport={viewport}
      />
    </WorkflowWithDefaultContext>
  )
}

const RagPipelineWrapper = () => {
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)

  if (!pipelineId)
    return <Conversion />

  return (
    <WorkflowContextProvider
      injectWorkflowStoreSliceFn={createRagPipelineSliceSlice as InjectWorkflowStoreSliceFn}
    >
      <RagPipeline />
    </WorkflowContextProvider>
  )
}

export default RagPipelineWrapper
