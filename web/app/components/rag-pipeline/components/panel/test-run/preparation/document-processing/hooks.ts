import { useQuery } from '@tanstack/react-query'
import { selectPipelineStepParameters } from '@/app/components/rag-pipeline/utils/query-select'
import { useStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'

export const useInputVariables = (datasourceNodeId: string) => {
  const pipelineId = useStore((state) => state.pipelineId)
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
