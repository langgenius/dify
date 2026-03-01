import { useStore } from '@/app/components/workflow/store'
import { useDraftPipelineProcessingParams } from '@/service/use-pipeline'

export const useInputVariables = (datasourceNodeId: string) => {
  const pipelineId = useStore(state => state.pipelineId)
  const { data: paramsConfig, isFetching: isFetchingParams } = useDraftPipelineProcessingParams({
    pipeline_id: pipelineId!,
    node_id: datasourceNodeId,
  })

  return {
    isFetchingParams,
    paramsConfig,
  }
}
