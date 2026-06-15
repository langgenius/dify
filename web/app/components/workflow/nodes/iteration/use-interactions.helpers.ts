import type {
  BlockEnum,
  ChildNodeTypeCount,
  Node,
} from '../../types'
import {
  ITERATION_PADDING,
} from '../../constants'
import { CUSTOM_ITERATION_START_NODE } from '../iteration-start/constants'

type ContainerBounds = {
  rightNode?: Node
  bottomNode?: Node
}

export const getIterationContainerBounds = (childrenNodes: Node[]): ContainerBounds => {
  return childrenNodes.reduce<ContainerBounds>((acc, node) => {
    const nextRightNode = !acc.rightNode || node.position.x + node.width! > acc.rightNode.position.x + acc.rightNode.width!
      ? node
      : acc.rightNode
    const nextBottomNode = !acc.bottomNode || node.position.y + node.height! > acc.bottomNode.position.y + acc.bottomNode.height!
      ? node
      : acc.bottomNode

    return {
      rightNode: nextRightNode,
      bottomNode: nextBottomNode,
    }
  }, {})
}

export const getIterationContainerResize = (currentNode: Node, bounds: ContainerBounds) => {
  const width = bounds.rightNode && currentNode.width! < bounds.rightNode.position.x + bounds.rightNode.width!
    ? bounds.rightNode.position.x + bounds.rightNode.width! + ITERATION_PADDING.right
    : undefined
  const height = bounds.bottomNode && currentNode.height! < bounds.bottomNode.position.y + bounds.bottomNode.height!
    ? bounds.bottomNode.position.y + bounds.bottomNode.height! + ITERATION_PADDING.bottom
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
  if (node.position.x + node.width! > parentNode.width! - ITERATION_PADDING.right)
    restrictPosition.x = parentNode.width! - ITERATION_PADDING.right - node.width!
  if (node.position.y + node.height! > parentNode.height! - ITERATION_PADDING.bottom)
    restrictPosition.y = parentNode.height! - ITERATION_PADDING.bottom - node.height!

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
