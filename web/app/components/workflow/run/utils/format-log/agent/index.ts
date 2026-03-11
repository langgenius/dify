import type { AgentLogItem, AgentLogItemWithChildren, NodeTracing } from '@/types/workflow'
import { cloneDeep } from 'es-toolkit/object'
import { BlockEnum } from '@/app/components/workflow/types'

const supportedAgentLogNodes = [BlockEnum.Agent, BlockEnum.Tool]

const remove = (node: AgentLogItemWithChildren, removeId: string) => {
  let { children } = node
  if (!children || children.length === 0)
    return

  const hasCircle = !!children.find((c) => {
    const childId = c.message_id || (c as any).id
    return childId === removeId
  })
  if (hasCircle) {
    node.hasCircle = true
    node.children = node.children.filter((c) => {
      const childId = c.message_id || (c as any).id
      return childId !== removeId
    })
    children = node.children
  }

  children.forEach((child) => {
    remove(child, removeId)
  })
}

const removeRepeatedSiblings = (list: AgentLogItemWithChildren[]) => {
  if (!list || list.length === 0)
    return []

  const result: AgentLogItemWithChildren[] = []
  const addedItemIds: string[] = []
  list.forEach((item) => {
    const itemId = item.message_id || (item as any).id
    if (itemId && !addedItemIds.includes(itemId)) {
      result.push(item)
      addedItemIds.push(itemId)
    }
  })
  return result
}

const removeCircleLogItem = (log: AgentLogItemWithChildren) => {
  const newLog = cloneDeep(log)

  // If no children, return as is
  if (!newLog.children || newLog.children.length === 0)
    return newLog

  newLog.children = removeRepeatedSiblings(newLog.children)
  const id = newLog.message_id || (newLog as any).id
  let { children } = newLog

  // check one step circle
  const hasOneStepCircle = !!children.find((c) => {
    const childId = c.message_id || (c as any).id
    return childId === id
  })
  if (hasOneStepCircle) {
    newLog.hasCircle = true
    newLog.children = newLog.children.filter((c) => {
      const childId = c.message_id || (c as any).id
      return childId !== id
    })
    children = newLog.children
  }

  children.forEach((child, index) => {
    remove(child, id) // check multi steps circle
    children[index] = removeCircleLogItem(child)
  })
  return newLog
}

const listToTree = (logs: AgentLogItem[]) => {
  if (!logs || logs.length === 0)
    return []

  // First pass: identify all unique items and track parent-child relationships
  const itemsById = new Map<string, any>()
  const childrenById = new Map<string, any[]>()

  logs.forEach((item) => {
    const itemId = item.message_id || (item as any).id

    // Only add to itemsById if not already there (keep first occurrence)
    if (itemId && !itemsById.has(itemId))
      itemsById.set(itemId, item)

    // Initialize children array for this ID if needed
    if (itemId && !childrenById.has(itemId))
      childrenById.set(itemId, [])

    // If this item has a parent, add it to parent's children list
    if (item.parent_id) {
      if (!childrenById.has(item.parent_id))
        childrenById.set(item.parent_id, [])

      childrenById.get(item.parent_id)!.push(item)
    }
  })

  // Second pass: build tree structure
  const tree: AgentLogItemWithChildren[] = []

  // Find root nodes (items without parents)
  itemsById.forEach((item) => {
    const hasParent = !!item.parent_id
    if (!hasParent) {
      const itemId = item.message_id || (item as any).id
      const children = childrenById.get(itemId)
      if (children && children.length > 0)
        item.children = children

      tree.push(item as AgentLogItemWithChildren)
    }
  })

  // Add children property to all items that have children
  itemsById.forEach((item) => {
    const itemId = item.message_id || (item as any).id
    const children = childrenById.get(itemId)
    if (children && children.length > 0)
      item.children = children
  })

  return tree
}

const buildToolCallHistoryLog = (item: NodeTracing): AgentLogItemWithChildren[] => {
  const history = item.outputs?.tool_call_history || item.process_data?.tool_call_history
  if (!Array.isArray(history) || history.length === 0)
    return []

  return history.map((round: any) => {
    const toolNames = (round.tool_calls || []).map((tc: any) => tc.function?.name || tc.name || 'tool').join(', ')
    return {
      message_id: `${item.id}-round-${round.round}`,
      node_execution_id: item.id,
      node_id: item.node_id,
      label: `Round ${round.round}: ${toolNames}`,
      status: 'succeeded',
      data: {
        tool_calls: round.tool_calls || [],
        tool_results: round.tool_results || [],
      },
      children: [],
    } as AgentLogItemWithChildren
  })
}

const format = (list: NodeTracing[]): NodeTracing[] => {
  const result: NodeTracing[] = list.map((item) => {
    let treeList: AgentLogItemWithChildren[] = []
    let removedCircleTree: AgentLogItemWithChildren[] = []
    if (supportedAgentLogNodes.includes(item.node_type) && item.execution_metadata?.agent_log && item.execution_metadata?.agent_log.length > 0)
      treeList = listToTree(item.execution_metadata.agent_log)
    // console.log(JSON.stringify(treeList))
    removedCircleTree = treeList.length > 0 ? treeList.map(t => removeCircleLogItem(t)) : []
    item.agentLog = removedCircleTree

    // LLM nodes with external tool callback: convert tool_call_history to agentLog
    if (item.node_type === BlockEnum.LLM && !item.agentLog?.length) {
      const toolCallLog = buildToolCallHistoryLog(item)
      if (toolCallLog.length > 0)
        item.agentLog = toolCallLog
    }

    return item
  })

  return result
}

export default format
