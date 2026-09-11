import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import { CUSTOM_ITERATION_START_NODE } from '../nodes/iteration-start/constants'
import { getRestrictedIterationPosition } from '../nodes/iteration/use-interactions.helpers'
import { CUSTOM_LOOP_START_NODE } from '../nodes/loop-start/constants'
import { getRestrictedLoopPosition } from '../nodes/loop/use-interactions.helpers'
import { useWorkflowStore } from '../store'
import { BlockEnum, ControlMode } from '../types'
import { getKeyboardMovement } from '../utils/keyboard-movement'
import { useCollaborativeWorkflow } from './use-collaborative-workflow'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useNodesReadOnly } from './use-workflow'
import { useWorkflowHistory, WorkflowHistoryEvent } from './use-workflow-history'

export function useNodeKeyboardInteractions(onSelect: (id: string, cancel?: boolean) => void) {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const workflow = useCollaborativeWorkflow()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { saveStateToHistory } = useWorkflowHistory()
  const { t } = useTranslation('workflow')

  return (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const isNodeTitle = target.hasAttribute('data-node-keyboard-target')
    const nodeTarget = isNodeTitle ? target.closest<HTMLElement>('.react-flow__node') : target
    const isNode = nodeTarget?.classList.contains('react-flow__node')
    const isSelection = target.classList.contains('react-flow__nodesselection-rect')
    if (!isNode && !isSelection) return
    // The title button owns its normal click activation.
    if (isNodeTitle && (event.key === 'Enter' || event.key === ' ')) return
    const movement = getKeyboardMovement(event)
    const isMovementKey = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    const isSelectionKey = ['Enter', ' ', 'Escape'].includes(event.key)
    if (!isMovementKey && !isSelectionKey) return

    // React Flow 11 mutates its internal nodes before onNodesChange. Handle these
    // keys before that mutation so collaboration receives the old and new positions.
    event.preventDefault()
    event.stopPropagation()
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (getNodesReadOnly() || workflowStore.getState().controlMode === ControlMode.Comment) return
    const { nodes, setNodes } = workflow.getState()
    const focusedNode = isNode
      ? nodes.find((node) => node.id === nodeTarget?.dataset.id)
      : undefined
    if (isNode && !focusedNode) return
    if (
      focusedNode &&
      (focusedNode.type === CUSTOM_ITERATION_START_NODE ||
        focusedNode.type === CUSTOM_LOOP_START_NODE ||
        focusedNode.data.type === BlockEnum.DataSourceEmpty)
    )
      return

    if (isSelectionKey) {
      if (focusedNode) onSelect(focusedNode.id, event.key === 'Escape')
      return
    }
    if (!movement) return
    if (!collaborationManager.canApplyLocalGraphMutation()) return

    const movingIds = new Set(
      nodes
        .filter(
          (node) =>
            (focusedNode && !focusedNode.selected ? node.id === focusedNode.id : node.selected) &&
            node.draggable !== false &&
            node.type !== CUSTOM_ITERATION_START_NODE &&
            node.type !== CUSTOM_LOOP_START_NODE &&
            node.data.type !== BlockEnum.DataSourceEmpty,
        )
        .map((node) => node.id),
    )
    let moved = false
    const nextNodes = nodes.map((node) => {
      if (!movingIds.has(node.id)) return node
      // A selected container already moves its descendants in canvas coordinates.
      let parent = nodes.find((candidate) => candidate.id === node.parentId)
      while (parent) {
        if (movingIds.has(parent.id)) return node
        parent = nodes.find((candidate) => candidate.id === parent?.parentId)
      }
      const next = {
        ...node,
        position: { x: node.position.x + movement.x, y: node.position.y + movement.y },
      }
      const parentNode = nodes.find((candidate) => candidate.id === node.parentId)
      const iteration = getRestrictedIterationPosition(next, parentNode)
      const loop = getRestrictedLoopPosition(next, parentNode)
      next.position = {
        x: iteration.x ?? loop.x ?? next.position.x,
        y: iteration.y ?? loop.y ?? next.position.y,
      }
      if (next.position.x === node.position.x && next.position.y === node.position.y) return node
      moved = true
      return next
    })
    if (!moved) return
    workflowStore.setState({ nodeAnimation: false })
    setNodes(nextNodes, true, 'keyboard-node-movement')
    handleSyncWorkflowDraft()
    saveStateToHistory(
      WorkflowHistoryEvent.NodeDragStop,
      focusedNode ? { nodeId: focusedNode.id } : undefined,
    )
    const announcedNode =
      nextNodes.find((node) => node.id === focusedNode?.id) ??
      nextNodes.find((node) => movingIds.has(node.id))
    if (announcedNode)
      store.setState({
        ariaLiveMessage: t(($) => $['keyboard.nodeMoved'], {
          title: announcedNode.data.title,
          x: Math.round(announcedNode.position.x),
          y: Math.round(announcedNode.position.y),
        }),
      })
  }
}
