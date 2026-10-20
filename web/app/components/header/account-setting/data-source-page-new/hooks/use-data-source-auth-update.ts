import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleQuery } from '@/service/console'

export const useDataSourceAuthUpdate = ({
  pluginId,
  provider,
}: {
  pluginId: string
  provider: string
}) => {
  const queryClient = useQueryClient()
  const handleAuthUpdate = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: consoleQuery.auth.plugin.datasource.list.get.queryKey(),
    })
    queryClient.invalidateQueries({
      queryKey: consoleQuery.auth.plugin.datasource.defaultList.get.queryKey(),
    })
    queryClient.invalidateQueries({
      queryKey: consoleQuery.rag.pipelines.datasourcePlugins.get.key(),
    })
    queryClient.invalidateQueries({
      queryKey: consoleQuery.auth.plugin.datasource.byProviderId.get.queryKey({
        input: { params: { provider_id: `${pluginId}/${provider}` } },
      }),
    })
  }, [pluginId, provider, queryClient])

  return {
    handleAuthUpdate,
  }
}
