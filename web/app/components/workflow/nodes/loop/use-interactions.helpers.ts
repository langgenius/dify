import type {
  BlockEnum,
  Node,
} from '../../types'
import {
  LOOP_CHILDREN_Z_INDEX,
  LOOP_PADDING,
} from '../../constants'
import { CUSTOM_LOOP_START_NODE } from '../loop-start/constants'

type ContainerBounds = {
  rightNode?: Node
  bottomNode?: Node
}

export const getContainerBounds = (childrenNodes: Node[]): ContainerBounds => {
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

export const getContainerResize = (currentNode: Node, bounds: ContainerBounds) => {
  const width = bounds.rightNode && currentNode.width! < bounds.rightNode.position.x + bounds.rightNode.width!
    ? bounds.rightNode.position.x + bounds.rightNode.width! + LOOP_PADDING.right
    : undefined
  const height = bounds.bottomNode && currentNode.height! < bounds.bottomNode.position.y + bounds.bottomNode.height!
    ? bounds.bottomNode.position.y + bounds.bottomNode.height! + LOOP_PADDING.bottom
    : undefined

  return {
    width,
    height,
  }
}

export const getRestrictedLoopPosition = (node: Node, parentNode?: Node) => {
  const restrictPosition: { x?: number, y?: number } = { x: undefined, y: undefined }

  if (!node.data.isInLoop || !parentNode)
    return restrictPosition

  if (node.position.y < LOOP_PADDING.top)
    restrictPosition.y = LOOP_PADDING.top
  if (node.position.x < LOOP_PADDING.left)
    restrictPosition.x = LOOP_PADDING.left
  if (node.position.x + node.width! > parentNode.width! - LOOP_PADDING.right)
    restrictPosition.x = parentNode.width! - LOOP_PADDING.right - node.width!
  if (node.position.y + node.height! > parentNode.height! - LOOP_PADDING.bottom)
    restrictPosition.y = parentNode.height! - LOOP_PADDING.bottom - node.height!

  return restrictPosition
}

export const getLoopChildren = (nodes: Node[], nodeId: string) => {
  return nodes.filter(node => node.parentId === nodeId && node.type !== CUSTOM_LOOP_START_NODE)
}

export const buildLoopChildCopy = ({
  child,
  childNodeType,
  defaultValue,
  nodesWithSameTypeCount,
  newNodeId,
  index,
}: {
  child: Node
  childNodeType: BlockEnum
  defaultValue: Node['data']
  nodesWithSameTypeCount: number
  newNodeId: string
  index: number
}) => {
  const params = {
    type: child.type!,
    data: {
      ...defaultValue,
      ...child.data,
      selected: false,
      _isBundled: false,
      _connectedSourceHandleIds: [],
      _connectedTargetHandleIds: [],
      _dimmed: false,
      title: nodesWithSameTypeCount > 0 ? `${defaultValue.title} ${nodesWithSameTypeCount + 1}` : defaultValue.title,
      isInLoop: true,
      loop_id: newNodeId,
      type: childNodeType,
    },
    position: child.position,
    positionAbsolute: child.positionAbsolute,
    parentId: newNodeId,
    extent: child.extent,
    zIndex: LOOP_CHILDREN_Z_INDEX,
  }

  return {
    params,
    newId: `${newNodeId}${index}`,
  }
}
