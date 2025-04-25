import { useMemo } from 'react'
import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store'
import { useHooksStore } from '@/app/components/workflow/hooks-store'

export const useNodesMetaData = () => {
  const availableNodesMetaData = useHooksStore(s => s.availableNodesMetaData)

  return useMemo(() => {
    return {
      nodes: availableNodesMetaData?.nodes || [],
      nodesMap: availableNodesMetaData?.nodesMap || {},
    } as AvailableNodesMetaData
  }, [availableNodesMetaData])
}
