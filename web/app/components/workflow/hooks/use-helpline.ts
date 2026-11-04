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

type HelpLineNodeCollections = {
  showHorizontalHelpLineNodes: Node[]
  showVerticalHelpLineNodes: Node[]
}

type NodeAlignPosition = {
  x: number
  y: number
}

const ALIGN_THRESHOLD = 5

const getEntryNodeDimension = (node: Node, dimension: 'width' | 'height') => {
  const offset = dimension === 'width' ? ENTRY_NODE_WRAPPER_OFFSET.x : ENTRY_NODE_WRAPPER_OFFSET.y

  return (node[dimension] ?? 0) - offset
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
  return nodes
    .filter((candidate) => {
      if (candidate.id === node.id) return false
      if (candidate.data.isInIteration || candidate.data.isInLoop) return false

      const candidateAlignPos = getNodeAlignPosition(candidate)
      const diff = Math.ceil(candidateAlignPos[axis]) - Math.ceil(nodeAlignPos[axis])
      return diff < ALIGN_THRESHOLD && diff > -ALIGN_THRESHOLD
    })
    .sort((a, b) => {
      const aPos = getNodeAlignPosition(a)
      const bPos = getNodeAlignPosition(b)
      return axis === 'y' ? aPos.x - bPos.x : aPos.y - bPos.y
    })
}

const buildHorizontalHelpLine = ({
  alignedNodes,
  node,
  getNodeAlignPosition,
  isEntryNode,
}: {
  alignedNodes: Node[]
  node: Node
  getNodeAlignPosition: (node: Node) => NodeAlignPosition
  isEntryNode: (node: Node) => boolean
}) => {
  if (!alignedNodes.length) return undefined

  const allNodes = [...alignedNodes, node]
  const left = Math.min(...allNodes.map((candidate) => getNodeAlignPosition(candidate).x))
  const right = Math.max(
    ...allNodes.map(
      (candidate) =>
        getNodeAlignPosition(candidate).x +
        (isEntryNode(candidate)
          ? getEntryNodeDimension(candidate, 'width')
          : (candidate.width ?? 0)),
    ),
  )

  return {
    top: getNodeAlignPosition(alignedNodes[0]!).y,
    left,
    width: right - left,
  }
}

const buildVerticalHelpLine = ({
  alignedNodes,
  node,
  getNodeAlignPosition,
  isEntryNode,
}: {
  alignedNodes: Node[]
  node: Node
  getNodeAlignPosition: (node: Node) => NodeAlignPosition
  isEntryNode: (node: Node) => boolean
}) => {
  if (!alignedNodes.length) return undefined

  const allNodes = [...alignedNodes, node]
  const top = Math.min(...allNodes.map((candidate) => getNodeAlignPosition(candidate).y))
  const bottom = Math.max(
    ...allNodes.map(
      (candidate) =>
        getNodeAlignPosition(candidate).y +
        (isEntryNode(candidate)
          ? getEntryNodeDimension(candidate, 'height')
          : (candidate.height ?? 0)),
    ),
  )

  return {
    top,
    left: getNodeAlignPosition(alignedNodes[0]!).x,
    height: bottom - top,
  }
}

export const useHelpline = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  // Check if a node is an entry node (Start or Trigger)
  const isEntryNode = useCallback((node: Node): boolean => {
    return isTriggerNode(node.data.type) || node.data.type === BlockEnum.Start
  }, [])

  // Get the actual alignment position of a node (accounting for wrapper offset)
  const getNodeAlignPosition = useCallback(
    (node: Node) => {
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
    },
    [isEntryNode],
  )

  const handleSetHelpline = useCallback(
    (node: Node) => {
      const { getNodes } = store.getState()
      const nodes = getNodes()
      const { setHelpLineHorizontal, setHelpLineVertical } = workflowStore.getState()

      if (node.data.isInIteration || node.data.isInLoop) {
        setHelpLineHorizontal(undefined)
        setHelpLineVertical(undefined)
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

      setHelpLineHorizontal(
        buildHorizontalHelpLine({
          alignedNodes: showHorizontalHelpLineNodes,
          node,
          getNodeAlignPosition,
          isEntryNode,
        }),
      )
      setHelpLineVertical(
        buildVerticalHelpLine({
          alignedNodes: showVerticalHelpLineNodes,
          node,
          getNodeAlignPosition,
          isEntryNode,
        }),
      )

      return {
        showHorizontalHelpLineNodes,
        showVerticalHelpLineNodes,
      } satisfies HelpLineNodeCollections
    },
    [store, workflowStore, getNodeAlignPosition, isEntryNode],
  )

  return {
    handleSetHelpline,
  }
}
