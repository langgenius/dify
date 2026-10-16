import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { selectPipelineStepParameters } from '@/app/components/rag-pipeline/utils/query-select'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { consoleQuery } from '@/service/console'

export const useInputVariables = (datasourceNodeId: string) => {
  const pipelineId = useAtomValue(knowledgePipelineIdentityAtom).pipelineId
  const { data: paramsConfig, isFetching: isFetchingParams } = useQuery(
    consoleQuery.rag.pipelines.byPipelineId.workflows.draft.processing.parameters.get.queryOptions({
      input: { params: { pipeline_id: pipelineId! }, query: { node_id: datasourceNodeId } },
      select: selectPipelineStepParameters,
    }),
  )

  return {
    isFetchingParams,
    paramsConfig,
  }
}
