import type { EvaluationResourceType } from '../../../types'
import { useMemo } from 'react'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { usePublishedPipelineInfo } from '@/service/use-pipeline'
import { useSnippetPublishedWorkflow } from '@/service/use-snippet-workflows'
import { useAppWorkflow } from '@/service/use-workflow'
import { getGraphNodes, getRagPipelineInputFields, getStartNodeInputFields } from './input-fields-utils'

export const usePublishedInputFields = (
  resourceType: EvaluationResourceType,
  resourceId: string,
) => {
  const { data: currentAppWorkflow, isLoading: isAppWorkflowLoading } = useAppWorkflow(resourceType === 'apps' ? resourceId : '')
  const { data: currentSnippetWorkflow, isLoading: isSnippetWorkflowLoading } = useSnippetPublishedWorkflow(resourceType === 'snippets' ? resourceId : '')
  const pipelineId = useDatasetDetailContextWithSelector(state => state.dataset?.pipeline_id)
  const { data: currentPipelineWorkflow, isLoading: isPipelineWorkflowLoading } = usePublishedPipelineInfo(resourceType === 'datasets' ? (pipelineId ?? '') : '')

  const inputFields = useMemo(() => {
    if (resourceType === 'apps')
      return getStartNodeInputFields(currentAppWorkflow?.graph.nodes)

    if (resourceType === 'snippets')
      return getStartNodeInputFields(getGraphNodes(currentSnippetWorkflow?.graph))

    if (resourceType === 'datasets')
      return getRagPipelineInputFields(currentPipelineWorkflow?.rag_pipeline_variables)

    return []
  }, [currentAppWorkflow?.graph.nodes, currentPipelineWorkflow?.rag_pipeline_variables, currentSnippetWorkflow?.graph, resourceType])

  return {
    inputFields,
    isInputFieldsLoading: (resourceType === 'apps' && isAppWorkflowLoading)
      || (resourceType === 'snippets' && isSnippetWorkflowLoading)
      || (resourceType === 'datasets' && isPipelineWorkflowLoading),
  }
}
