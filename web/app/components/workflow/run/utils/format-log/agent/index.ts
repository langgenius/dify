import { BlockEnum } from '@/app/components/workflow/types'
import type { AgentLogItem, AgentLogItemWithChildren, NodeTracing } from '@/types/workflow'
import { cloneDeep } from 'lodash-es'

const supportedAgentLogNodes = [BlockEnum.Agent, BlockEnum.Tool]

const remove = (node: AgentLogItemWithChildren, removeId: string) => {
  let { children } = node
  if (!children || children.length === 0)
    return

  const hasCircle = !!children.find(c => c.id === removeId)
  if (hasCircle) {
    node.hasCircle = true
    node.children = node.children.filter(c => c.id !== removeId)
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
    if (!addedItemIds.includes(item.id)) {
      result.push(item)
      addedItemIds.push(item.id)
    }
  })
  return result
}

const removeCircleLogItem = (log: AgentLogItemWithChildren) => {
  const newLog = cloneDeep(log)
  newLog.children = removeRepeatedSiblings(newLog.children)
  let { id, children } = newLog
  if (!children || children.length === 0)
    return log

  // check one step circle
  const hasOneStepCircle = !!children.find(c => c.id === id)
  if (hasOneStepCircle) {
    newLog.hasCircle = true
    newLog.children = newLog.children.filter(c => c.id !== id)
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

  const tree: AgentLogItemWithChildren[] = []
  logs.forEach((log) => {
    const hasParent = !!log.parent_id
    if (hasParent) {
      const parent = logs.find(item => item.id === log.parent_id) as AgentLogItemWithChildren
      if (parent) {
        if (!parent.children)
          parent.children = []
        parent.children.push(log as AgentLogItemWithChildren)
      }
    }
    else {
      tree.push(log as AgentLogItemWithChildren)
    }
  })
  return tree
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

    return item
  })

  return result
}

export default format
