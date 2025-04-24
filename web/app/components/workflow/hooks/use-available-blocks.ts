import {
  useCallback,
  useMemo,
} from 'react'
import { BlockEnum } from '../types'
import { useNodesMetaData } from './use-nodes-meta-data'

const availableBlocksFilter = (nodeType: BlockEnum, inContainer?: boolean) => {
  if (inContainer && (nodeType === BlockEnum.Iteration || nodeType === BlockEnum.Loop || nodeType === BlockEnum.End))
    return false

  if (!inContainer && nodeType === BlockEnum.LoopEnd)
    return false

  return true
}

export const useAvailableBlocks = (nodeType?: BlockEnum, inContainer?: boolean) => {
  const {
    nodes: availableNodes,
  } = useNodesMetaData()
  const availableNodesType = useMemo(() => availableNodes.map(node => node.type), [availableNodes])
  const availablePrevBlocks = useMemo(() => {
    if (!nodeType || nodeType === BlockEnum.Start)
      return []

    return availableNodesType
  }, [availableNodesType, nodeType])
  const availableNextBlocks = useMemo(() => {
    if (!nodeType || nodeType === BlockEnum.End || nodeType === BlockEnum.LoopEnd)
      return []

    return availableNodesType
  }, [availableNodesType, nodeType])

  const getAvailableBlocks = useCallback((nodeType?: BlockEnum, inContainer?: boolean) => {
    let availablePrevBlocks = availableNodesType
    if (!nodeType || nodeType === BlockEnum.Start)
      availablePrevBlocks = []

    let availableNextBlocks = availableNodesType
    if (!nodeType || nodeType === BlockEnum.End || nodeType === BlockEnum.LoopEnd)
      availableNextBlocks = []

    return {
      availablePrevBlocks: availablePrevBlocks.filter(nType => availableBlocksFilter(nType, inContainer)),
      availableNextBlocks: availableNextBlocks.filter(nType => availableBlocksFilter(nType, inContainer)),
    }
  }, [availableNodesType])

  return useMemo(() => {
    return {
      getAvailableBlocks,
      availablePrevBlocks: availablePrevBlocks.filter(nType => availableBlocksFilter(nType, inContainer)),
      availableNextBlocks: availableNextBlocks.filter(nType => availableBlocksFilter(nType, inContainer)),
    }
  }, [getAvailableBlocks, availablePrevBlocks, availableNextBlocks, inContainer])
}
