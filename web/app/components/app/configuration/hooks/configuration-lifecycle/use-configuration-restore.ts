import { queryOptions, useQueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { fetchDatasets } from '@/service/datasets'
import { useAllToolProviders } from '@/service/use-tools'
import { basePath } from '@/utils/var'
import { buildConfigurationDefaults, getConfigurationDatasetIds } from './load'

export function useConfigurationRestore({
  appId,
  currentRerankModel,
  currentRerankProvider,
}: {
  appId: string
  currentRerankModel?: string
  currentRerankProvider?: string
}) {
  const queryClient = useQueryClient()
  const { refetch: refetchCollections } = useAllToolProviders()

  return async () => {
    const [response, collections] = await Promise.all([
      queryClient.query(
        consoleQuery.apps.byAppId.get.queryOptions({
          input: { params: { app_id: appId } },
          staleTime: 0,
        }),
      ),
      refetchCollections({ throwOnError: true }),
    ])
    if (!response.model_config) throw new Error(`App ${appId} has no model configuration`)
    if (!collections.data) throw new Error('Tool collections are unavailable')
    const datasetIds = getConfigurationDatasetIds(response.model_config)
    const datasets = datasetIds.length
      ? await queryClient.query(
          queryOptions({
            queryKey: ['configuration', 'datasets', datasetIds],
            queryFn: () =>
              fetchDatasets({ url: '/datasets', params: { page: 1, ids: datasetIds } }),
            staleTime: 0,
          }),
        )
      : undefined

    return buildConfigurationDefaults({
      response,
      collections: collections.data,
      nextDataSets: datasets?.data ?? [],
      basePath,
      currentRerankModel,
      currentRerankProvider,
    }).publishedConfig
  }
}
