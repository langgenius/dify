import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleQuery } from '@/service/console'
import {
  useInvalidDataSourceAuth,
  useInvalidDataSourceListAuth,
  useInvalidDefaultDataSourceListAuth,
} from '@/service/use-datasource'

export const useDataSourceAuthUpdate = ({
  pluginId,
  provider,
}: {
  pluginId: string
  provider: string
}) => {
  const queryClient = useQueryClient()
  const invalidateDataSourceListAuth = useInvalidDataSourceListAuth()
  const invalidDefaultDataSourceListAuth = useInvalidDefaultDataSourceListAuth()
  const invalidateDataSourceAuth = useInvalidDataSourceAuth({
    pluginId,
    provider,
  })
  const handleAuthUpdate = useCallback(() => {
    invalidateDataSourceListAuth()
    invalidDefaultDataSourceListAuth()
    queryClient.invalidateQueries({
      queryKey: consoleQuery.rag.pipelines.datasourcePlugins.get.key(),
    })
    invalidateDataSourceAuth()
  }, [
    invalidateDataSourceListAuth,
    queryClient,
    invalidateDataSourceAuth,
    invalidDefaultDataSourceListAuth,
  ])

  return {
    handleAuthUpdate,
  }
}
