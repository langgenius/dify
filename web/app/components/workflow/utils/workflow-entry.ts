import type { Node } from '../types'
import { BlockEnum, isTriggerNode } from '../types'

/**
 * Get the workflow entry node
 * Priority: trigger nodes > start node
 */
export function getWorkflowEntryNode(nodes: Node[]): Node | undefined {
  const triggerNode = nodes.find(node => isTriggerNode(node.data.type))
  if (triggerNode)
    return triggerNode

  return nodes.find(node => node.data.type === BlockEnum.Start)
}

/**
 * Check if a node type is a workflow entry node
 */
export function isWorkflowEntryNode(nodeType: BlockEnum): boolean {
  return nodeType === BlockEnum.Start || isTriggerNode(nodeType)
}

/**
 * Check if workflow is in trigger mode
 */
export function isTriggerWorkflow(nodes: Node[]): boolean {
  return nodes.some(node => isTriggerNode(node.data.type))
}
