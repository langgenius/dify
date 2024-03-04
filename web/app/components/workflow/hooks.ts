import { useCallback } from 'react'
import produce from 'immer'
import type {
  EdgeMouseHandler,
  NodeDragHandler,
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
import { getLayoutByDagre } from './utils'
import { useStore } from './store'

export const useWorkflow = () => {
  const store = useStoreApi()

  const handleLayout = useCallback(async () => {
    const {
      getNodes,
      edges,
      setNodes,
    } = store.getState()

    const layout = getLayoutByDagre(getNodes(), edges)

    const newNodes = produce(getNodes(), (draft) => {
      draft.forEach((node) => {
        const nodeWithPosition = layout.node(node.id)
        node.position = {
          x: nodeWithPosition.x,
          y: nodeWithPosition.y,
        }
      })
    })
    setNodes(newNodes)
  }, [store])

  const handleNodeDragStart = useCallback<NodeDragHandler>(() => {
    useStore.getState().setIsDragging(true)
  }, [])

  const handleNodeDrag = useCallback<NodeDragHandler>((e, node: Node) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    e.stopPropagation()

    const nodes = getNodes()

    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(n => n.id === node.id)!

      currentNode.position = node.position
    })

    setNodes(newNodes)
  }, [store])

  const handleNodeDragStop = useCallback<NodeDragHandler>(() => {
    useStore.getState().setIsDragging(false)
  }, [])

  const handleNodeEnter = useCallback<NodeMouseHandler>((_, node) => {
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

  const handleNodeLeave = useCallback<NodeMouseHandler>((_, node) => {
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
      draft.forEach((edge) => {
        edge.data = { ...edge.data, connectedNodeIsHovering: false }
      })
    })
    setEdges(newEdges)
  }, [store])

  const handleNodeSelect = useCallback((nodeId: string, cancelSelection?: boolean) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const newNodes = produce(getNodes(), (draft) => {
      draft.forEach(node => node.data.selected = false)
      const selectedNode = draft.find(node => node.id === nodeId)!

      if (!cancelSelection)
        selectedNode.data.selected = true
    })
    setNodes(newNodes)
  }, [store])

  const handleNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    if (useStore.getState().isDragging)
      return

    handleNodeSelect(node.id)
  }, [handleNodeSelect])

  const handleNodeConnect = useCallback<OnConnect>(({
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
        type: 'custom',
        source: source!,
        target: target!,
        sourceHandle,
        targetHandle,
      })

      return filtered
    })
    setEdges(newEdges)
  }, [store])

  const handleNodeDelete = useCallback((nodeId: string) => {
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

  const handleNodeDataUpdate = useCallback(({ id, data }: SelectedNode) => {
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

  const handleNodeAddNext = useCallback((currentNodeId: string, nodeType: BlockEnum, sourceHandle: string) => {
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
        node.data.selected = false
      })
      draft.push(nextNode)
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.push(newEdge)
    })
    setEdges(newEdges)
  }, [store])

  const handleNodeChange = useCallback((currentNodeId: string, nodeType: BlockEnum, sourceHandle?: string) => {
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

  const handleEdgeEnter = useCallback<EdgeMouseHandler>((_, edge) => {
    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)!

      currentEdge.data = { ...currentEdge.data, hovering: true }
    })
    setEdges(newEdges)
  }, [store])

  const handleEdgeLeave = useCallback<EdgeMouseHandler>((_, edge) => {
    const {
      edges,
      setEdges,
    } = store.getState()
    const newEdges = produce(edges, (draft) => {
      const currentEdge = draft.find(e => e.id === edge.id)!

      currentEdge.data = { ...currentEdge.data, hovering: false }
    })
    setEdges(newEdges)
  }, [store])

  const handleEdgeDelete = useCallback(() => {
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

  return {
    handleLayout,

    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
    handleNodeEnter,
    handleNodeLeave,
    handleNodeSelect,
    handleNodeClick,
    handleNodeConnect,
    handleNodeDelete,
    handleNodeDataUpdate,
    handleNodeAddNext,
    handleNodeChange,

    handleEdgeEnter,
    handleEdgeLeave,
    handleEdgeDelete,
  }
}
