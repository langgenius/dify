import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import type { Node } from './types'

export const useWorkflow = (nodes: Node[], initialSelectedNodeId?: string) => {
  const [selectedNodeId, setSelectedNodeId] = useState(initialSelectedNodeId)

  const handleSelectedNodeIdChange = useCallback((nodeId: string) => setSelectedNodeId(nodeId), [])

  const selectedNode = useMemo(() => {
    return nodes.find(node => node.id === selectedNodeId)
  }, [nodes, selectedNodeId])

  return {
    selectedNodeId,
    selectedNode,
    handleSelectedNodeIdChange,
  }
}
