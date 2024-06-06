import type { MouseEvent } from 'react'
import {
  useCallback,
} from 'react'
import produce from 'immer'
import type {
  OnSelectionChangeFunc,
} from 'reactflow'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '../store'
import type { Node } from '../types'

export const useSelectionInteractions = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleSelectionStart = useCallback(() => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
      userSelectionRect,
    } = store.getState()

    if (!userSelectionRect?.width || !userSelectionRect?.height) {
      const nodes = getNodes()
      const newNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          if (node.data._isBundled)
            node.data._isBundled = false
        })
      })
      setNodes(newNodes)
      const newEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          if (edge.data._isBundled)
            edge.data._isBundled = false
        })
      })
      setEdges(newEdges)
    }
  }, [store])

  const handleSelectionChange = useCallback<OnSelectionChangeFunc>(({ nodes: nodesInSelection, edges: edgesInSelection }) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
      userSelectionRect,
    } = store.getState()

    const nodes = getNodes()

    if (!userSelectionRect?.width || !userSelectionRect?.height)
      return

    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        const nodeInSelection = nodesInSelection.find(n => n.id === node.id)

        if (nodeInSelection)
          node.data._isBundled = true
        else
          node.data._isBundled = false
      })
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.forEach((edge) => {
        const edgeInSelection = edgesInSelection.find(e => e.id === edge.id)

        if (edgeInSelection)
          edge.data._isBundled = true
        else
          edge.data._isBundled = false
      })
    })
    setEdges(newEdges)
  }, [store])

  const handleSelectionDrag = useCallback((_: MouseEvent, nodesWithDrag: Node[]) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()

    workflowStore.setState({
      nodeAnimation: false,
    })
    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        const dragNode = nodesWithDrag.find(n => n.id === node.id)

        if (dragNode)
          node.position = dragNode.position
      })
    })
    setNodes(newNodes)
  }, [store, workflowStore])

  const handleSelectionCancel = useCallback(() => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()

    store.setState({
      userSelectionRect: null,
      userSelectionActive: true,
    })

    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        if (node.data._isBundled)
          node.data._isBundled = false
      })
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.forEach((edge) => {
        if (edge.data._isBundled)
          edge.data._isBundled = false
      })
    })
    setEdges(newEdges)
  }, [store])

  return {
    handleSelectionStart,
    handleSelectionChange,
    handleSelectionDrag,
    handleSelectionCancel,
  }
}
