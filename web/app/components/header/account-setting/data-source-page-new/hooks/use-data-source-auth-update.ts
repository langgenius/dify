import { useCallback } from 'react'
import { useInvalidDataSourceListAuth } from '@/service/use-datasource'
import { useInvalidDefaultDataSourceListAuth } from '@/service/use-datasource'
import { useInvalidDataSourceList } from '@/service/use-pipeline'

export const useDataSourceAuthUpdate = () => {
  const invalidateDataSourceListAuth = useInvalidDataSourceListAuth()
  const invalidDefaultDataSourceListAuth = useInvalidDefaultDataSourceListAuth()
  const invalidateDataSourceList = useInvalidDataSourceList()
  const handleAuthUpdate = useCallback(() => {
    invalidateDataSourceListAuth()
    invalidDefaultDataSourceListAuth()
    invalidateDataSourceList()
  }, [invalidateDataSourceListAuth, invalidateDataSourceList])

  return {
    handleAuthUpdate,
  }
}
