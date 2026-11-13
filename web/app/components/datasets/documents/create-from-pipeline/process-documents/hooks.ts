import { useQuery } from '@tanstack/react-query'
import { selectPipelineStepParameters } from '@/app/components/rag-pipeline/utils/query-select'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { consoleQuery } from '@/service/console'

export const useInputVariables = (datasourceNodeId: string) => {
  const pipelineId = useDatasetDetailContextWithSelector((state) => state.dataset?.pipeline_id)
  const { data: paramsConfig, isFetching: isFetchingParams } = useQuery(
    consoleQuery.rag.pipelines.byPipelineId.workflows.published.processing.parameters.get.queryOptions(
      {
        input: { params: { pipeline_id: pipelineId! }, query: { node_id: datasourceNodeId } },
        select: selectPipelineStepParameters,
      },
    ),
  )

  return {
    paramsConfig,
    isFetchingParams,
  }
}
