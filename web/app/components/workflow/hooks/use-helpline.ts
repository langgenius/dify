import type { Node } from '../types'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '../store'
import { BlockEnum, isTriggerNode } from '../types'

// Entry node (Start/Trigger) wrapper offsets
// The EntryNodeContainer adds a wrapper with status indicator above the actual node
// These offsets ensure alignment happens on the inner node, not the wrapper
const ENTRY_NODE_WRAPPER_OFFSET = {
  x: 0, // No horizontal padding on wrapper (px-0)
  y: 21, // Actual measured: pt-0.5 (2px) + status bar height (~19px)
} as const

export const useHelpline = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  // Check if a node is an entry node (Start or Trigger)
  const isEntryNode = useCallback((node: Node): boolean => {
    return isTriggerNode(node.data.type as any) || node.data.type === BlockEnum.Start
  }, [])

  // Get the actual alignment position of a node (accounting for wrapper offset)
  const getNodeAlignPosition = useCallback((node: Node) => {
    if (isEntryNode(node)) {
      return {
        x: node.position.x + ENTRY_NODE_WRAPPER_OFFSET.x,
        y: node.position.y + ENTRY_NODE_WRAPPER_OFFSET.y,
      }
    }
    return {
      x: node.position.x,
      y: node.position.y,
    }
  }, [isEntryNode])

  const handleSetHelpline = useCallback((node: Node) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const {
      setHelpLineHorizontal,
      setHelpLineVertical,
    } = workflowStore.getState()

    if (node.data.isInIteration) {
      return {
        showHorizontalHelpLineNodes: [],
        showVerticalHelpLineNodes: [],
      }
    }

    if (node.data.isInLoop) {
      return {
        showHorizontalHelpLineNodes: [],
        showVerticalHelpLineNodes: [],
      }
    }

    // Get the actual alignment position for the dragging node
    const nodeAlignPos = getNodeAlignPosition(node)

    const showHorizontalHelpLineNodes = nodes.filter((n) => {
      if (n.id === node.id)
        return false

      if (n.data.isInIteration)
        return false

      if (n.data.isInLoop)
        return false

      // Get actual alignment position for comparison node
      const nAlignPos = getNodeAlignPosition(n)
      const nY = Math.ceil(nAlignPos.y)
      const nodeY = Math.ceil(nodeAlignPos.y)

      if (nY - nodeY < 5 && nY - nodeY > -5)
        return true

      return false
    }).sort((a, b) => {
      const aPos = getNodeAlignPosition(a)
      const bPos = getNodeAlignPosition(b)
      return aPos.x - bPos.x
    })

    const showHorizontalHelpLineNodesLength = showHorizontalHelpLineNodes.length
    if (showHorizontalHelpLineNodesLength > 0) {
      const first = showHorizontalHelpLineNodes[0]
      const last = showHorizontalHelpLineNodes[showHorizontalHelpLineNodesLength - 1]

      // Use actual alignment positions for help line rendering
      const firstPos = getNodeAlignPosition(first)
      const lastPos = getNodeAlignPosition(last)

      // For entry nodes, we need to subtract the offset from width since lastPos already includes it
      const lastIsEntryNode = isEntryNode(last)
      const lastNodeWidth = lastIsEntryNode ? last.width! - ENTRY_NODE_WRAPPER_OFFSET.x : last.width!

      const helpLine = {
        top: firstPos.y,
        left: firstPos.x,
        width: lastPos.x + lastNodeWidth - firstPos.x,
      }

      if (nodeAlignPos.x < firstPos.x) {
        const firstIsEntryNode = isEntryNode(first)
        const firstNodeWidth = firstIsEntryNode ? first.width! - ENTRY_NODE_WRAPPER_OFFSET.x : first.width!
        helpLine.left = nodeAlignPos.x
        helpLine.width = firstPos.x + firstNodeWidth - nodeAlignPos.x
      }

      if (nodeAlignPos.x > lastPos.x) {
        const nodeIsEntryNode = isEntryNode(node)
        const nodeWidth = nodeIsEntryNode ? node.width! - ENTRY_NODE_WRAPPER_OFFSET.x : node.width!
        helpLine.width = nodeAlignPos.x + nodeWidth - firstPos.x
      }

      setHelpLineHorizontal(helpLine)
    }
    else {
      setHelpLineHorizontal()
    }

    const showVerticalHelpLineNodes = nodes.filter((n) => {
      if (n.id === node.id)
        return false
      if (n.data.isInIteration)
        return false
      if (n.data.isInLoop)
        return false

      // Get actual alignment position for comparison node
      const nAlignPos = getNodeAlignPosition(n)
      const nX = Math.ceil(nAlignPos.x)
      const nodeX = Math.ceil(nodeAlignPos.x)

      if (nX - nodeX < 5 && nX - nodeX > -5)
        return true

      return false
    }).sort((a, b) => {
      const aPos = getNodeAlignPosition(a)
      const bPos = getNodeAlignPosition(b)
      return aPos.x - bPos.x
    })
    const showVerticalHelpLineNodesLength = showVerticalHelpLineNodes.length

    if (showVerticalHelpLineNodesLength > 0) {
      const first = showVerticalHelpLineNodes[0]
      const last = showVerticalHelpLineNodes[showVerticalHelpLineNodesLength - 1]

      // Use actual alignment positions for help line rendering
      const firstPos = getNodeAlignPosition(first)
      const lastPos = getNodeAlignPosition(last)

      // For entry nodes, we need to subtract the offset from height since lastPos already includes it
      const lastIsEntryNode = isEntryNode(last)
      const lastNodeHeight = lastIsEntryNode ? last.height! - ENTRY_NODE_WRAPPER_OFFSET.y : last.height!

      const helpLine = {
        top: firstPos.y,
        left: firstPos.x,
        height: lastPos.y + lastNodeHeight - firstPos.y,
      }

      if (nodeAlignPos.y < firstPos.y) {
        const firstIsEntryNode = isEntryNode(first)
        const firstNodeHeight = firstIsEntryNode ? first.height! - ENTRY_NODE_WRAPPER_OFFSET.y : first.height!
        helpLine.top = nodeAlignPos.y
        helpLine.height = firstPos.y + firstNodeHeight - nodeAlignPos.y
      }

      if (nodeAlignPos.y > lastPos.y) {
        const nodeIsEntryNode = isEntryNode(node)
        const nodeHeight = nodeIsEntryNode ? node.height! - ENTRY_NODE_WRAPPER_OFFSET.y : node.height!
        helpLine.height = nodeAlignPos.y + nodeHeight - firstPos.y
      }

      setHelpLineVertical(helpLine)
    }
    else {
      setHelpLineVertical()
    }

    return {
      showHorizontalHelpLineNodes,
      showVerticalHelpLineNodes,
    }
  }, [store, workflowStore, getNodeAlignPosition])

  return {
    handleSetHelpline,
  }
}
