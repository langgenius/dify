import { Button } from '@langgenius/dify-ui/button'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { initialEdges, initialNodes } from '@/app/components/workflow/utils'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { getErrorMessage } from '@/utils/error-message'
import Conversion from './components/conversion'
import RagPipelineMain from './components/rag-pipeline-main'
import { usePipelineInit } from './hooks/use-pipeline-init'
import { createRagPipelineSliceSlice } from './store'
import { processNodesWithoutDataSource } from './utils'

const RagPipeline = () => {
  const { t } = useTranslation(['common'])
  const { data, isLoading, error, refetch } = usePipelineInit()
  const nodesData = useMemo(() => {
    if (data) return initialNodes(data.graph.nodes, data.graph.edges)

    return []
  }, [data])
  const edgesData = useMemo(() => {
    if (data) return initialEdges(data.graph.edges, data.graph.nodes)

    return []
  }, [data])

  if (error && !isLoading) {
    return (
      <div role="alert" className="flex size-full flex-col items-center justify-center gap-3 p-6">
        <p className="system-sm-regular text-text-destructive">
          {getErrorMessage(error) ?? t(($) => $['api.actionFailed'])}
        </p>
        <Button onClick={() => void refetch()}>{t(($) => $['operation.retry'])}</Button>
      </div>
    )
  }

  if (!data || isLoading) {
    return (
      <div className="relative flex size-full items-center justify-center">
        <LoadingPlaceholder />
      </div>
    )
  }

  const { nodes: processedNodes, viewport } = processNodesWithoutDataSource(
    nodesData,
    data.graph.viewport,
  )
  return (
    <WorkflowWithDefaultContext edges={edgesData} nodes={processedNodes}>
      <RagPipelineMain edges={edgesData} nodes={processedNodes} viewport={viewport} />
    </WorkflowWithDefaultContext>
  )
}

const RagPipelineWrapper = () => {
  const pipelineId = useDatasetDetailContextWithSelector((s) => s.dataset?.pipeline_id)

  if (!pipelineId) return <Conversion />

  return (
    <EditorResourceScope resource={{ kind: 'knowledge-pipeline', pipelineId }}>
      <WorkflowContextProvider injectWorkflowStoreSliceFn={createRagPipelineSliceSlice}>
        <RagPipeline />
      </WorkflowContextProvider>
    </EditorResourceScope>
  )
}

export default RagPipelineWrapper
