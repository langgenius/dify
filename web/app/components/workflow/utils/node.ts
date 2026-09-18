import type { IterationNodeType } from '../nodes/iteration/types'
import type { LoopNodeType } from '../nodes/loop/types'
import type { CommonNodeType, Node } from '../types'
import { Position } from 'reactflow'
import { CUSTOM_SIMPLE_NODE } from '@/app/components/workflow/simple-node/constants'
import { CUSTOM_NODE, NESTED_ELEMENT_Z_INDEX } from '../constants'
import { isAgentV2NodeData } from '../nodes/agent-v2/types'
import { CUSTOM_ITERATION_START_NODE } from '../nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '../nodes/loop-start/constants'
import { BlockEnum } from '../types'

export function getNodeCatalogType(data: CommonNodeType): BlockEnum {
  return isAgentV2NodeData(data) ? BlockEnum.AgentV2 : data.type
}

export function generateNewNode({
  data,
  position,
  id,
  zIndex,
  type,
  ...rest
}: Omit<Node, 'id'> & { id?: string }): {
  newNode: Node
  newIterationStartNode?: Node
  newLoopStartNode?: Node
} {
  const newNode = {
    id: id || `${Date.now()}`,
    type: type || CUSTOM_NODE,
    data,
    position,
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
    zIndex: data.type === BlockEnum.Iteration || data.type === BlockEnum.Loop ? 0 : zIndex,
    ...rest,
  } as Node

  if (data.type === BlockEnum.Iteration) {
    const newIterationStartNode = getIterationStartNode(newNode.id)
    ;(newNode.data as IterationNodeType).start_node_id = newIterationStartNode.id
    ;(newNode.data as IterationNodeType)._children = [
      { nodeId: newIterationStartNode.id, nodeType: BlockEnum.IterationStart },
    ]
    return {
      newNode,
      newIterationStartNode,
    }
  }

  if (data.type === BlockEnum.Loop) {
    const newLoopStartNode = getLoopStartNode(newNode.id)
    ;(newNode.data as LoopNodeType).start_node_id = newLoopStartNode.id
    ;(newNode.data as LoopNodeType)._children = [
      { nodeId: newLoopStartNode.id, nodeType: BlockEnum.LoopStart },
    ]
    return {
      newNode,
      newLoopStartNode,
    }
  }

  return {
    newNode,
  }
}

export function getIterationStartNode(iterationId: string): Node {
  return generateNewNode({
    id: `${iterationId}start`,
    type: CUSTOM_ITERATION_START_NODE,
    data: {
      title: '',
      desc: '',
      type: BlockEnum.IterationStart,
      isInIteration: true,
    },
    position: {
      x: 24,
      y: 68,
    },
    zIndex: NESTED_ELEMENT_Z_INDEX,
    parentId: iterationId,
    selectable: false,
    draggable: false,
  }).newNode
}

export function getLoopStartNode(loopId: string): Node {
  return generateNewNode({
    id: `${loopId}start`,
    type: CUSTOM_LOOP_START_NODE,
    data: {
      title: '',
      desc: '',
      type: BlockEnum.LoopStart,
      isInLoop: true,
    },
    position: {
      x: 24,
      y: 68,
    },
    zIndex: NESTED_ELEMENT_Z_INDEX,
    parentId: loopId,
    selectable: false,
    draggable: false,
  }).newNode
}

export const genNewNodeTitleFromOld = (oldTitle: string) => {
  const regex = /^(.+?)\s*\((\d+)\)\s*$/
  const match = regex.exec(oldTitle)

  if (match) {
    const title = match[1]
    const num = Number.parseInt(match[2]!, 10)
    return `${title} (${num + 1})`
  } else {
    return `${oldTitle} (1)`
  }
}

export const getTopLeftNodePosition = (nodes: Node[]) => {
  let minX = Infinity
  let minY = Infinity

  nodes.forEach((node) => {
    if (node.position.x < minX) minX = node.position.x

    if (node.position.y < minY) minY = node.position.y
  })

  return {
    x: minX,
    y: minY,
  }
}

export const getNestedNodePosition = (node: Node, parentNode: Node) => {
  return {
    x: node.position.x - parentNode.position.x,
    y: node.position.y - parentNode.position.y,
  }
}

export const getNodesWithSameDefaultDataType = (
  nodes: Node[],
  nodeType: BlockEnum,
  defaultValue: Partial<Node['data']>,
) => {
  const dataType = (defaultValue.type as BlockEnum | undefined) ?? nodeType
  const discriminatorEntries = (['agent_node_kind', 'version'] as const)
    .map((key) => [key, (defaultValue as Record<string, unknown>)[key]] as const)
    .filter(([, value]) => value !== undefined)

  if (dataType !== nodeType && discriminatorEntries.length > 0) {
    return nodes.filter(
      (node) =>
        node.data.type === dataType &&
        discriminatorEntries.every(
          ([key, value]) => (node.data as Record<string, unknown>)[key] === value,
        ),
    )
  }

  return nodes.filter((node) => node.data.type === dataType)
}

export const hasRetryNode = (nodeType?: BlockEnum) => {
  return (
    nodeType === BlockEnum.LLM ||
    nodeType === BlockEnum.Tool ||
    nodeType === BlockEnum.HttpRequest ||
    nodeType === BlockEnum.Code
  )
}

export const getNodeCustomTypeByNodeDataType = (nodeType: BlockEnum) => {
  if (nodeType === BlockEnum.LoopEnd) return CUSTOM_SIMPLE_NODE
}
