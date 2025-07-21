import { useCallback } from 'react'
import { useInvalidDataSourceListAuth } from '@/service/use-datasource'
import { useInvalidDataSourceList } from '@/service/use-pipeline'

export const useDataSourceAuthUpdate = () => {
  const invalidateDataSourceListAuth = useInvalidDataSourceListAuth()
  const invalidateDataSourceList = useInvalidDataSourceList()
  const handleAuthUpdate = useCallback(() => {
    invalidateDataSourceListAuth()
    invalidateDataSourceList()
  }, [invalidateDataSourceListAuth, invalidateDataSourceList])

  return {
    handleAuthUpdate,
  }
}
