import type {
  BlockEnum,
  ChildNodeTypeCount,
  Node,
} from '../../types'
import {
  ITERATION_PADDING,
} from '../../constants'
import {
  getNodeHeight,
  getNodeWidth,
} from '../../utils/node'
import { CUSTOM_ITERATION_START_NODE } from '../iteration-start/constants'

type ContainerBounds = {
  rightNode?: Node
  bottomNode?: Node
}

export const getIterationContainerBounds = (childrenNodes: Node[]): ContainerBounds => {
  return childrenNodes.reduce<ContainerBounds>((acc, node) => {
    const nextRightNode = !acc.rightNode || node.position.x + getNodeWidth(node) > acc.rightNode.position.x + getNodeWidth(acc.rightNode)
      ? node
      : acc.rightNode
    const nextBottomNode = !acc.bottomNode || node.position.y + getNodeHeight(node) > acc.bottomNode.position.y + getNodeHeight(acc.bottomNode)
      ? node
      : acc.bottomNode

    return {
      rightNode: nextRightNode,
      bottomNode: nextBottomNode,
    }
  }, {})
}

export const getIterationContainerResize = (currentNode: Node, bounds: ContainerBounds) => {
  const width = bounds.rightNode && getNodeWidth(currentNode) < bounds.rightNode.position.x + getNodeWidth(bounds.rightNode)
    ? bounds.rightNode.position.x + getNodeWidth(bounds.rightNode) + ITERATION_PADDING.right
    : undefined
  const height = bounds.bottomNode && getNodeHeight(currentNode) < bounds.bottomNode.position.y + getNodeHeight(bounds.bottomNode)
    ? bounds.bottomNode.position.y + getNodeHeight(bounds.bottomNode) + ITERATION_PADDING.bottom
    : undefined

  return {
    width,
    height,
  }
}

export const getRestrictedIterationPosition = (node: Node, parentNode?: Node) => {
  const restrictPosition: { x?: number, y?: number } = { x: undefined, y: undefined }

  if (!node.data.isInIteration || !parentNode)
    return restrictPosition

  if (node.position.y < ITERATION_PADDING.top)
    restrictPosition.y = ITERATION_PADDING.top
  if (node.position.x < ITERATION_PADDING.left)
    restrictPosition.x = ITERATION_PADDING.left
  if (node.position.x + getNodeWidth(node) > getNodeWidth(parentNode) - ITERATION_PADDING.right)
    restrictPosition.x = getNodeWidth(parentNode) - ITERATION_PADDING.right - getNodeWidth(node)
  if (node.position.y + getNodeHeight(node) > getNodeHeight(parentNode) - ITERATION_PADDING.bottom)
    restrictPosition.y = getNodeHeight(parentNode) - ITERATION_PADDING.bottom - getNodeHeight(node)

  return restrictPosition
}

export const getIterationChildren = (nodes: Node[], nodeId: string) => {
  return nodes.filter(node => node.parentId === nodeId && node.type !== CUSTOM_ITERATION_START_NODE)
}

export const getNextChildNodeTypeCount = (
  childNodeTypeCount: ChildNodeTypeCount,
  childNodeType: BlockEnum,
  nodesWithSameTypeCount: number,
) => {
  if (!childNodeTypeCount[childNodeType])
    childNodeTypeCount[childNodeType] = nodesWithSameTypeCount + 1
  else
    childNodeTypeCount[childNodeType] = childNodeTypeCount[childNodeType] + 1

  return childNodeTypeCount[childNodeType]
}

export const buildIterationChildCopy = ({
  child,
  childNodeType,
  defaultValue,
  title,
  newNodeId,
}: {
  child: Node
  childNodeType: BlockEnum
  defaultValue: Node['data']
  title: string
  newNodeId: string
}) => {
  return {
    type: child.type!,
    data: {
      ...defaultValue,
      ...child.data,
      selected: false,
      _isBundled: false,
      _connectedSourceHandleIds: [],
      _connectedTargetHandleIds: [],
      title,
      iteration_id: newNodeId,
      type: childNodeType,
    },
    position: child.position,
    positionAbsolute: child.positionAbsolute,
    parentId: newNodeId,
    extent: child.extent,
    zIndex: child.zIndex,
  }
}
