import { usePublishedPipelineProcessingParams } from '@/service/use-pipeline'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'

export const useInputVariables = (datasourceNodeId: string) => {
  const pipelineId = useDatasetDetailContextWithSelector(state => state.dataset?.pipeline_id)
  const { data: paramsConfig, isFetching: isFetchingParams } = usePublishedPipelineProcessingParams({
    pipeline_id: pipelineId!,
    node_id: datasourceNodeId,
  })

  return {
    paramsConfig,
    isFetchingParams,
  }
}
