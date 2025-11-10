import { useCallback } from 'react'
import type { MemoryVariable } from '@/app/components/workflow/types'
import { useNodeUpdate } from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { findUsedVarNodes } from '@/app/components/workflow/nodes/_base/components/variable/utils'

export const useMemoryUsedDetector = (nodeId: string) => {
  const { getNodeData } = useNodeUpdate(nodeId)
  const getMemoryUsedDetector = useCallback((chatVar: MemoryVariable) => {
    const nodeData = getNodeData()!
    const valueSelector = ['memory_block', chatVar.node_id ? `${chatVar.node_id}_${chatVar.id}` : chatVar.id]
    return findUsedVarNodes(
      valueSelector,
      [nodeData],
    )
  }, [getNodeData])

  return {
    getMemoryUsedDetector,
  }
}
