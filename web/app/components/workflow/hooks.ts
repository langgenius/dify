import type {
  Dispatch,
  SetStateAction,
} from 'react'
import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import produce from 'immer'
import type { Edge } from 'reactflow'
import type {
  BlockEnum,
  Node,
} from './types'
import { NodeInitialData } from './constants'

export const useWorkflow = (
  nodes: Node[],
  edges: Edge[],
  setNodes: Dispatch<SetStateAction<Node[]>>,
  setEdges: Dispatch<SetStateAction<Edge[]>>,
  initialSelectedNodeId?: string,
) => {
  const [selectedNodeId, setSelectedNodeId] = useState(initialSelectedNodeId)

  const handleSelectedNodeIdChange = useCallback((nodeId: string) => setSelectedNodeId(nodeId), [])

  const selectedNode = useMemo(() => {
    return nodes.find(node => node.id === selectedNodeId)
  }, [nodes, selectedNodeId])

  const handleAddNextNode = useCallback((prevNode: Node, nextNodeType: BlockEnum) => {
    const prevNodeDom = document.querySelector(`.react-flow__node-custom[data-id="${prevNode.id}"]`)
    const prevNodeDomHeight = prevNodeDom?.getBoundingClientRect().height || 0

    const nextNode = {
      id: `node-${Date.now()}`,
      type: 'custom',
      position: {
        x: prevNode.position.x,
        y: prevNode.position.y + prevNodeDomHeight + 64,
      },
      data: NodeInitialData[nextNodeType],
    }
    const newEdge = {
      id: `edge-${Date.now()}`,
      source: prevNode.id,
      target: nextNode.id,
    }
    setNodes((oldNodes) => {
      return produce(oldNodes, (draft) => {
        draft.push(nextNode)
      })
    })
    setEdges((oldEdges) => {
      return produce(oldEdges, (draft) => {
        draft.push(newEdge)
      })
    })
  }, [setNodes, setEdges])

  const handleUpdateNodeData = useCallback((nodeId: string, data: Node['data']) => {
    setNodes((oldNodes) => {
      return produce(oldNodes, (draft) => {
        const node = draft.find(node => node.id === nodeId)
        if (node)
          node.data = data
      })
    })
  }, [setNodes])

  return {
    selectedNodeId,
    selectedNode,
    handleSelectedNodeIdChange,
    handleAddNextNode,
    handleUpdateNodeData,
  }
}
