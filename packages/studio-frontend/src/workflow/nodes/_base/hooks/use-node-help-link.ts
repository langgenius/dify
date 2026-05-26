import type { BlockEnum } from '../../../types'
import { useMemo } from 'react'
import { useNodesMetaData } from '../../../hooks'

export const useNodeHelpLink = (nodeType: BlockEnum) => {
  const availableNodesMetaData = useNodesMetaData()

  const link = useMemo(() => {
    const result = availableNodesMetaData?.nodesMap?.[nodeType]?.metaData.helpLinkUri || ''

    return result
  }, [availableNodesMetaData, nodeType])

  return link
}
