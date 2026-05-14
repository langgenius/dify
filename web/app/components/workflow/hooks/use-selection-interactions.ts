import type {
  OnSelectionChangeFunc,
} from '@xyflow/react'
import type { MouseEvent } from 'react'
import type { Edge, Node } from '../types'
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

type BundledItem = Node | Edge

const applySelectionState = <T extends BundledItem>(items: T[], selectedIds: Set<string>) => {
  let changed = false

  const nextItems = items.map((item) => {
    const shouldBeSelected = selectedIds.has(item.id)

    if (!!item.data._isBundled === shouldBeSelected && !!item.selected === shouldBeSelected)
      return item

    changed = true
    return {
      ...item,
      selected: shouldBeSelected,
      data: {
        ...item.data,
        _isBundled: shouldBeSelected,
      },
    }
  })

  return changed ? nextItems : items
}

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
      const selectedIds = new Set<string>()
      const newNodes = applySelectionState(nodes as Node[], selectedIds)
      if (newNodes !== nodes)
        setNodes(newNodes)

      const newEdges = applySelectionState(edges as Edge[], selectedIds)
      if (newEdges !== edges)
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

    const selectedNodeIds = new Set(nodesInSelection.map(node => node.id))
    const newNodes = applySelectionState(nodes as Node[], selectedNodeIds)
    if (newNodes !== nodes)
      setNodes(newNodes)

    const selectedEdgeIds = new Set(edgesInSelection.map(edge => edge.id))
    const newEdges = applySelectionState(edges as Edge[], selectedEdgeIds)
    if (newEdges !== edges)
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

    const selectedIds = new Set<string>()
    const newNodes = applySelectionState(nodes as Node[], selectedIds)
    if (newNodes !== nodes)
      setNodes(newNodes)

    const newEdges = applySelectionState(edges as Edge[], selectedIds)
    if (newEdges !== edges)
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
