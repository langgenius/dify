import type { Node } from '../types'
import { useCallback } from 'react'
import { useWorkflowStoreApi } from '@/app/components/workflow/hooks/use-workflow-reactflow'
import { useWorkflowStore } from '../store'
import { BlockEnum, isTriggerNode } from '../types'
import {
  getNodeHeight,
  getNodeWidth,
} from '../utils'

// Entry node (Start/Trigger) wrapper offsets
// The EntryNodeContainer adds a wrapper with status indicator above the actual node
// These offsets ensure alignment happens on the inner node, not the wrapper
const ENTRY_NODE_WRAPPER_OFFSET = {
  x: 0, // No horizontal padding on wrapper (px-0)
  y: 21, // Actual measured: pt-0.5 (2px) + status bar height (~19px)
} as const

type HelpLineNodeCollections = {
  showHorizontalHelpLineNodes: Node[]
  showVerticalHelpLineNodes: Node[]
}

type NodeAlignPosition = {
  x: number
  y: number
}

const ALIGN_THRESHOLD = 5

const getEntryNodeDimension = (
  node: Node,
  dimension: 'width' | 'height',
) => {
  const offset = dimension === 'width'
    ? ENTRY_NODE_WRAPPER_OFFSET.x
    : ENTRY_NODE_WRAPPER_OFFSET.y

  return (dimension === 'width' ? getNodeWidth(node) : getNodeHeight(node)) - offset
}

const getAlignedNodes = ({
  nodes,
  node,
  nodeAlignPos,
  axis,
  getNodeAlignPosition,
}: {
  nodes: Node[]
  node: Node
  nodeAlignPos: NodeAlignPosition
  axis: 'x' | 'y'
  getNodeAlignPosition: (node: Node) => NodeAlignPosition
}) => {
  return nodes.filter((candidate) => {
    if (candidate.id === node.id)
      return false
    if (candidate.data.isInIteration || candidate.data.isInLoop)
      return false

    const candidateAlignPos = getNodeAlignPosition(candidate)
    const diff = Math.ceil(candidateAlignPos[axis]) - Math.ceil(nodeAlignPos[axis])
    return diff < ALIGN_THRESHOLD && diff > -ALIGN_THRESHOLD
  }).sort((a, b) => {
    const aPos = getNodeAlignPosition(a)
    const bPos = getNodeAlignPosition(b)
    return aPos.x - bPos.x
  })
}

const buildHorizontalHelpLine = ({
  alignedNodes,
  node,
  nodeAlignPos,
  getNodeAlignPosition,
  isEntryNode,
}: {
  alignedNodes: Node[]
  node: Node
  nodeAlignPos: NodeAlignPosition
  getNodeAlignPosition: (node: Node) => NodeAlignPosition
  isEntryNode: (node: Node) => boolean
}) => {
  if (!alignedNodes.length)
    return undefined

  const first = alignedNodes[0]
  const last = alignedNodes[alignedNodes.length - 1]
  const firstPos = getNodeAlignPosition(first!)
  const lastPos = getNodeAlignPosition(last!)
  const helpLine = {
    top: firstPos.y,
    left: firstPos.x,
    width: lastPos.x + (isEntryNode(last!) ? getEntryNodeDimension(last!, 'width') : getNodeWidth(last)) - firstPos.x,
  }

  if (nodeAlignPos.x < firstPos.x) {
    helpLine.left = nodeAlignPos.x
    helpLine.width = firstPos.x + (isEntryNode(first!) ? getEntryNodeDimension(first!, 'width') : getNodeWidth(first)) - nodeAlignPos.x
  }

  if (nodeAlignPos.x > lastPos.x)
    helpLine.width = nodeAlignPos.x + (isEntryNode(node) ? getEntryNodeDimension(node, 'width') : getNodeWidth(node)) - firstPos.x

  return helpLine
}

const buildVerticalHelpLine = ({
  alignedNodes,
  node,
  nodeAlignPos,
  getNodeAlignPosition,
  isEntryNode,
}: {
  alignedNodes: Node[]
  node: Node
  nodeAlignPos: NodeAlignPosition
  getNodeAlignPosition: (node: Node) => NodeAlignPosition
  isEntryNode: (node: Node) => boolean
}) => {
  if (!alignedNodes.length)
    return undefined

  const first = alignedNodes[0]
  const last = alignedNodes[alignedNodes.length - 1]
  const firstPos = getNodeAlignPosition(first!)
  const lastPos = getNodeAlignPosition(last!)
  const helpLine = {
    top: firstPos.y,
    left: firstPos.x,
    height: lastPos.y + (isEntryNode(last!) ? getEntryNodeDimension(last!, 'height') : getNodeHeight(last)) - firstPos.y,
  }

  if (nodeAlignPos.y < firstPos.y) {
    helpLine.top = nodeAlignPos.y
    helpLine.height = firstPos.y + (isEntryNode(first!) ? getEntryNodeDimension(first!, 'height') : getNodeHeight(first)) - nodeAlignPos.y
  }

  if (nodeAlignPos.y > lastPos.y)
    helpLine.height = nodeAlignPos.y + (isEntryNode(node) ? getEntryNodeDimension(node, 'height') : getNodeHeight(node)) - firstPos.y

  return helpLine
}

export const useHelpline = () => {
  const store = useWorkflowStoreApi()
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
    const { nodes } = store.getState()
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

    const showHorizontalHelpLineNodes = getAlignedNodes({
      nodes,
      node,
      nodeAlignPos,
      axis: 'y',
      getNodeAlignPosition,
    })
    const showVerticalHelpLineNodes = getAlignedNodes({
      nodes,
      node,
      nodeAlignPos,
      axis: 'x',
      getNodeAlignPosition,
    })

    setHelpLineHorizontal(buildHorizontalHelpLine({
      alignedNodes: showHorizontalHelpLineNodes,
      node,
      nodeAlignPos,
      getNodeAlignPosition,
      isEntryNode,
    }))
    setHelpLineVertical(buildVerticalHelpLine({
      alignedNodes: showVerticalHelpLineNodes,
      node,
      nodeAlignPos,
      getNodeAlignPosition,
      isEntryNode,
    }))

    return {
      showHorizontalHelpLineNodes,
      showVerticalHelpLineNodes,
    } satisfies HelpLineNodeCollections
  }, [store, workflowStore, getNodeAlignPosition, isEntryNode])

  return {
    handleSetHelpline,
  }
}
