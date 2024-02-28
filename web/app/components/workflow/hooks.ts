import { useCallback } from 'react'
import produce from 'immer'
import type {
  EdgeMouseHandler,
  NodeMouseHandler,
  OnConnect,
} from 'reactflow'
import {
  getConnectedEdges,
  getIncomers,
  useStoreApi,
} from 'reactflow'
import type {
  BlockEnum,
  Node,
  SelectedNode,
} from './types'
import { NodeInitialData } from './constants'
import { initialNodesPosition } from './utils'

export const useWorkflow = () => {
  const store = useStoreApi()

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

  const handleSelectNode = useCallback((nodeId: string, cancelSelection?: boolean) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const newNodes = produce(getNodes(), (draft) => {
      const selectedNode = draft.find(node => node.id === nodeId)

      if (selectedNode) {
        if (cancelSelection)
          selectedNode.selected = false
        else
          selectedNode.selected = true
      }
    })
    setNodes(newNodes)
  }, [store])

  const handleConnectNode = useCallback<OnConnect>(({
    source,
    sourceHandle,
    target,
    targetHandle,
  }) => {
    const {
      edges,
      setEdges,
    } = store.getState()

    const newEdges = produce(edges, (draft) => {
      const filtered = draft.filter(edge => edge.source !== source && edge.target !== target)

      filtered.push({
        id: `${source}-${target}`,
        source: source!,
        target: target!,
        sourceHandle,
        targetHandle,
      })

      return filtered
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

  const handleDeleteEdge = useCallback(() => {
    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const index = draft.findIndex(edge => edge.selected)

      if (index > -1)
        draft.splice(index, 1)
    })
    setEdges(newEdges)
  }, [store])

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
  }, [store])

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
      data: NodeInitialData[nodeType],
      position: {
        x: currentNode.position.x + 304,
        y: currentNode.position.y,
      },
      selected: true,
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
        node.selected = false
      })
      draft.push(nextNode)
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.push(newEdge)
    })
    setEdges(newEdges)
  }, [store])

  const handleChangeCurrentNode = useCallback((currentNodeId: string, nodeType: BlockEnum, sourceHandle?: string) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(node => node.id === currentNodeId)!
    const incomers = getIncomers(currentNode, nodes, edges)
    const connectedEdges = getConnectedEdges([currentNode], edges)
    const newCurrentNode: Node = {
      id: `${Date.now()}`,
      type: 'custom',
      data: NodeInitialData[nodeType],
      position: {
        x: currentNode.position.x,
        y: currentNode.position.y,
      },
    }
    const newNodes = produce(nodes, (draft) => {
      const index = draft.findIndex(node => node.id === currentNodeId)

      draft.splice(index, 1, newCurrentNode)
    })
    setNodes(newNodes)
    if (incomers.length === 1) {
      const parentNodeId = incomers[0].id

      const newEdge = {
        id: `${parentNodeId}-${newCurrentNode.id}`,
        type: 'custom',
        source: parentNodeId,
        sourceHandle: sourceHandle || 'source',
        target: newCurrentNode.id,
        targetHandle: 'target',
      }

      const newEdges = produce(edges, (draft) => {
        const filtered = draft.filter(edge => !connectedEdges.find(connectedEdge => connectedEdge.id === edge.id))
        filtered.push(newEdge)

        return filtered
      })
      setEdges(newEdges)
    }
  }, [store])

  const handleDeleteNode = useCallback((nodeId: string) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()

    const newNodes = produce(getNodes(), (draft) => {
      const index = draft.findIndex(node => node.id === nodeId)

      if (index > -1)
        draft.splice(index, 1)
    })
    setNodes(newNodes)
    const connectedEdges = getConnectedEdges([{ id: nodeId } as Node], edges)
    const newEdges = produce(edges, (draft) => {
      return draft.filter(edge => !connectedEdges.find(connectedEdge => connectedEdge.id === edge.id))
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
    handleSelectNode,
    handleEnterEdge,
    handleLeaveEdge,
    handleConnectNode,
    handleDeleteEdge,
    handleUpdateNodeData,
    handleAddNextNode,
    handleChangeCurrentNode,
    handleDeleteNode,
    handleInitialLayoutNodes,
    handleUpdateNodesPosition,
  }
}
