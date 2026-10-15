import { useStore } from '@/app/components/workflow/store'
import { useLoadFailureMeta } from '@/hooks/use-load-failure-meta'
import { useDraftPipelineProcessingParams } from '@/service/use-pipeline'

export const useInputVariables = (datasourceNodeId: string) => {
  const pipelineId = useStore((state) => state.pipelineId)
  const {
    data: paramsConfig,
    isFetching: isFetchingParams,
    isError: isParamsError,
  } = useDraftPipelineProcessingParams(
    {
      pipeline_id: pipelineId!,
      node_id: datasourceNodeId,
    },
    true,
    { meta: useLoadFailureMeta() },
  )

  return {
    isFetchingParams,
    // Running with the empty form of a failed load would drop the pipeline's parameters.
    isParamsError: isParamsError && !paramsConfig,
    paramsConfig,
  }
}
