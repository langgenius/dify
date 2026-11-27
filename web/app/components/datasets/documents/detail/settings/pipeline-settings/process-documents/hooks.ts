import { useQuery } from '@tanstack/react-query'
import { selectPipelineStepParameters } from '@/app/components/rag-pipeline/utils/query-select'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'

export const useInputVariables = (datasourceNodeId: string) => {
  const pipelineId = useDatasetDetailContextWithSelector((state) => state.dataset?.pipeline_id)
  const paramsQuery = useQuery(
    consoleQuery.rag.pipelines.byPipelineId.workflows.published.processing.parameters.get.queryOptions(
      {
        input: { params: { pipeline_id: pipelineId! }, query: { node_id: datasourceNodeId } },
        select: selectPipelineStepParameters,
      },
    ),
  )

  const { data: paramsConfig, isFetching: isFetchingParams } = paramsQuery
  // Without the processing parameters the form would be empty and run without them; a failed
  // refetch keeps the cached parameters and is reported by the query cache. The only caller
  // renders this load error, so claiming it here keeps it off the toasts.
  const paramsLoad = useOwnedQueryError(paramsQuery)
  const paramsLoadError = paramsLoad && {
    error: paramsLoad.error,
    retrying: paramsLoad.retrying,
    onRetry: paramsLoad.retry,
  }

  return {
    paramsConfig,
    isFetchingParams,
    paramsLoadError,
  }
}
