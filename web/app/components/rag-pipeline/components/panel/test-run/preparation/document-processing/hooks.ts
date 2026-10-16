import { useAtomValue } from 'jotai'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useDraftPipelineProcessingParams } from '@/service/use-pipeline'

export const useInputVariables = (datasourceNodeId: string) => {
  const pipelineId = useAtomValue(knowledgePipelineIdentityAtom).pipelineId
  const { data: paramsConfig, isFetching: isFetchingParams } = useDraftPipelineProcessingParams({
    pipeline_id: pipelineId!,
    node_id: datasourceNodeId,
  })

  return {
    isFetchingParams,
    paramsConfig,
  }
}
