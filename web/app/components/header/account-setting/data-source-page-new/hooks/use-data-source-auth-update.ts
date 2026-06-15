import { useCallback } from 'react'
import { useInvalidDataSourceAuth, useInvalidDataSourceListAuth, useInvalidDefaultDataSourceListAuth } from '@/service/use-datasource'
import { useInvalidDataSourceList } from '@/service/use-pipeline'

export const useDataSourceAuthUpdate = ({
  pluginId,
  provider,
}: {
  pluginId: string
  provider: string
}) => {
  const invalidateDataSourceListAuth = useInvalidDataSourceListAuth()
  const invalidDefaultDataSourceListAuth = useInvalidDefaultDataSourceListAuth()
  const invalidateDataSourceList = useInvalidDataSourceList()
  const invalidateDataSourceAuth = useInvalidDataSourceAuth({
    pluginId,
    provider,
  })
  const handleAuthUpdate = useCallback(() => {
    invalidateDataSourceListAuth()
    invalidDefaultDataSourceListAuth()
    invalidateDataSourceList()
    invalidateDataSourceAuth()
  }, [invalidateDataSourceListAuth, invalidateDataSourceList, invalidateDataSourceAuth, invalidDefaultDataSourceListAuth])

  return {
    handleAuthUpdate,
  }
}
