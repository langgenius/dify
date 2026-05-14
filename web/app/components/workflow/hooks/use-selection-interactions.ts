import type {
  OnSelectionChangeFunc,
} from '@xyflow/react'
import type { MouseEvent } from 'react'
import type { Node } from '../types'
import {
  produce,
} from 'immer'
import {
  useCallback,
} from 'react'
import { useWorkflowStoreApi } from '@/app/components/workflow/hooks/use-workflow-reactflow'
import { useWorkflowStore } from '../store'
import { useCollaborativeWorkflow } from './use-collaborative-workflow'
import { useNodesReadOnly } from './use-workflow'

export const useSelectionInteractions = () => {
  const store = useWorkflowStoreApi()
  const workflowStore = useWorkflowStore()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const { getNodesReadOnly } = useNodesReadOnly()

  const handleSelectionStart = useCallback(() => {
    const {
      nodes,
      setNodes,
      edges,
      setEdges,
      userSelectionRect,
    } = store.getState()

    if (!userSelectionRect?.width || !userSelectionRect?.height) {
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
      nodes,
      setNodes,
      edges,
      setEdges,
      userSelectionRect,
    } = store.getState()

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
    workflowStore.setState({
      nodeAnimation: false,
    })

    if (getNodesReadOnly())
      return

    const { nodes, setNodes } = collaborativeWorkflow.getState()
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        const dragNode = nodesWithDrag.find(n => n.id === node.id)

        if (dragNode)
          node.position = dragNode.position
      })
    })
    setNodes(newNodes, true, 'use-selection-interactions:handleSelectionDrag')
  }, [collaborativeWorkflow, getNodesReadOnly, workflowStore])

  const handleSelectionCancel = useCallback(() => {
    const {
      nodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()

    store.setState({
      userSelectionRect: null,
      userSelectionActive: true,
    })

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

  const handleSelectionContextMenu = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.classList.contains('react-flow__nodesselection-rect'))
      return

    e.preventDefault()
    workflowStore.setState({
      nodeMenu: undefined,
      panelMenu: undefined,
      edgeMenu: undefined,
      selectionMenu: {
        clientX: e.clientX,
        clientY: e.clientY,
      },
    })
  }, [workflowStore])

  const handleSelectionContextmenuCancel = useCallback(() => {
    workflowStore.setState({
      selectionMenu: undefined,
    })
  }, [workflowStore])

  return {
    handleSelectionStart,
    handleSelectionChange,
    handleSelectionDrag,
    handleSelectionCancel,
    handleSelectionContextMenu,
    handleSelectionContextmenuCancel,
  }
}
