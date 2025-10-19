import { useMemo } from 'react'
import type { BlockEnum } from '@/app/components/workflow/types'
import { useNodesMetaData } from '@/app/components/workflow/hooks'

export const useNodeHelpLink = (nodeType: BlockEnum) => {
  const availableNodesMetaData = useNodesMetaData()

  const link = useMemo(() => {
    const result = availableNodesMetaData?.nodesMap?.[nodeType]?.metaData.helpLinkUri || ''

    return result
  }, [availableNodesMetaData, nodeType])

  return link
}
