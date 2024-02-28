import { useCallback } from 'react'
import produce from 'immer'
import type {
  EdgeMouseHandler,
  NodeMouseHandler,
} from 'reactflow'
import {
  getConnectedEdges,
  useStoreApi,
} from 'reactflow'
import type {
  BlockEnum,
  Node,
  SelectedNode,
} from './types'
import { NodeInitialData } from './constants'
import { useStore } from './store'
import { initialNodesPosition } from './utils'

export const useWorkflow = () => {
  const store = useStoreApi()
  const setSelectedNode = useStore(state => state.setSelectedNode)

  const handleEnterNode = useCallback<NodeMouseHandler>((_, node) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      const currentNode = draft.find(n => n.id === node.id)!

      currentNode.data.hovering = true
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      const connectedEdges = getConnectedEdges([node], edges)

      connectedEdges.forEach((edge) => {
        const currentEdge = draft.find(e => e.id === edge.id)
        if (currentEdge)
          currentEdge.data = { ...currentEdge.data, connectedNodeIsHovering: true }
      })
    })
    setEdges(newEdges)
  }, [store])

  const handleLeaveNode = useCallback<NodeMouseHandler>((_, node) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      const currentNode = draft.find(n => n.id === node.id)!

      currentNode.data.hovering = false
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      const connectedEdges = getConnectedEdges([node], edges)

      connectedEdges.forEach((edge) => {
        const currentEdge = draft.find(e => e.id === edge.id)
        if (currentEdge)
          currentEdge.data = { ...currentEdge.data, connectedNodeIsHovering: false }
      })
    })
    setEdges(newEdges)
  }, [store])

  const handleEnterEdge = useCallback<EdgeMouseHandler>((_, edge) => {
    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)
      if (currentEdge)
        currentEdge.data = { ...currentEdge.data, hovering: true }
    })
    setEdges(newEdges)
  }, [store])

  const handleLeaveEdge = useCallback<EdgeMouseHandler>((_, edge) => {
    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)
      if (currentEdge)
        currentEdge.data = { ...currentEdge.data, hovering: false }
    })
    setEdges(newEdges)
  }, [store])

  const handleSelectNode = useCallback((selectNode: SelectedNode, cancelSelection?: boolean) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    if (cancelSelection) {
      setSelectedNode(null)
      const newNodes = produce(getNodes(), (draft) => {
        draft.forEach((item) => {
          item.data.selected = false
        })
      })
      setNodes(newNodes)
    }
    else {
      setSelectedNode(selectNode)
      const newNodes = produce(getNodes(), (draft) => {
        draft.forEach((item) => {
          if (item.id === selectNode.id)
            item.data.selected = true
          else
            item.data.selected = false
        })
      })
      setNodes(newNodes)
    }
  }, [setSelectedNode, store])

  const handleUpdateNodeData = useCallback(({ id, data }: SelectedNode) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      const currentNode = draft.find(node => node.id === id)!

      currentNode.data = { ...currentNode.data, ...data }
    })
    setNodes(newNodes)
    setSelectedNode({ id, data })
  }, [store, setSelectedNode])

  const handleAddNextNode = useCallback((currentNodeId: string, nodeType: BlockEnum, sourceHandle: string) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === currentNodeId)!
    const nextNode: Node = {
      id: `${Date.now()}`,
      type: 'custom',
      data: {
        ...NodeInitialData[nodeType],
        selected: true,
      },
      position: {
        x: currentNode.position.x + 304,
        y: currentNode.position.y,
      },
    }
    const newEdge = {
      id: `${currentNode.id}-${nextNode.id}`,
      type: 'custom',
      source: currentNode.id,
      sourceHandle,
      target: nextNode.id,
      targetHandle: 'target',
    }
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        node.data = { ...node.data, selected: false }
      })
      draft.push(nextNode)
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.push(newEdge)
    })
    setEdges(newEdges)
    setSelectedNode(nextNode)
  }, [store, setSelectedNode])

  const handleChangeCurrentNode = useCallback((parentNodeId: string, currentNodeId: string, nodeType: BlockEnum, sourceHandle: string) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === currentNodeId)!
    const connectedEdges = getConnectedEdges([currentNode], edges)
    const newCurrentNode: Node = {
      id: `${Date.now()}`,
      type: 'custom',
      data: {
        ...NodeInitialData[nodeType],
        selected: true,
      },
      position: {
        x: currentNode.position.x,
        y: currentNode.position.y,
      },
    }
    const newEdge = {
      id: `${parentNodeId}-${newCurrentNode.id}`,
      type: 'custom',
      source: parentNodeId,
      sourceHandle,
      target: newCurrentNode.id,
      targetHandle: 'target',
    }
    const newNodes = produce(nodes, (draft) => {
      const index = draft.findIndex(node => node.id === currentNodeId)

      draft.splice(index, 1, newCurrentNode)
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      const filtered = draft.filter(edge => !connectedEdges.find(connectedEdge => connectedEdge.id === edge.id))
      filtered.push(newEdge)

      return filtered
    })
    setEdges(newEdges)
  }, [store])

  const handleInitialLayoutNodes = useCallback(() => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()

    setNodes(initialNodesPosition(getNodes(), edges))
    setEdges(produce(edges, (draft) => {
      draft.forEach((edge) => {
        edge.hidden = false
      })
    }))
  }, [store])

  const handleUpdateNodesPosition = useCallback(() => {
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodes = getNodes()
    const groups = nodes.reduce((acc, cur) => {
      const x = cur.data.position.x

      if (!acc[x])
        acc[x] = [cur]
      else
        acc[x].push(cur)

      return acc
    }, {} as Record<string, Node[]>)
    const heightMap: Record<string, number> = {}

    Object.keys(groups).forEach((key) => {
      let baseHeight = 0
      groups[key].sort((a, b) => a.data.position!.y - b.data.position!.y).forEach((node) => {
        heightMap[node.id] = baseHeight
        baseHeight = node.height! + 39
      })
    })
    setNodes(produce(nodes, (draft) => {
      draft.forEach((node) => {
        node.position = {
          ...node.position,
          x: node.data.position.x * (220 + 64),
          y: heightMap[node.id],
        }
      })
    }))
  }, [store])

  return {
    handleEnterNode,
    handleLeaveNode,
    handleEnterEdge,
    handleLeaveEdge,
    handleSelectNode,
    handleUpdateNodeData,
    handleAddNextNode,
    handleChangeCurrentNode,
    handleInitialLayoutNodes,
    handleUpdateNodesPosition,
  }
}
