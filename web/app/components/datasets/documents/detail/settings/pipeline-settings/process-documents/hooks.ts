import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useLoadFailureMeta } from '@/hooks/use-load-failure-meta'
import { usePublishedPipelineProcessingParams } from '@/service/use-pipeline'

export const useInputVariables = (datasourceNodeId: string) => {
  const pipelineId = useDatasetDetailContextWithSelector((state) => state.dataset?.pipeline_id)
  const {
    data: paramsConfig,
    isFetching: isFetchingParams,
    isError: isParamsError,
  } = usePublishedPipelineProcessingParams(
    {
      pipeline_id: pipelineId!,
      node_id: datasourceNodeId,
    },
    { meta: useLoadFailureMeta() },
  )

  return {
    paramsConfig,
    isFetchingParams,
    // Processing with the empty form of a failed load would drop the pipeline's parameters.
    isParamsError: isParamsError && !paramsConfig,
  }
}
