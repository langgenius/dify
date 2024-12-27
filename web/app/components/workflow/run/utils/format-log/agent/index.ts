import { BlockEnum } from '@/app/components/workflow/types'
import type { AgentLogItem, AgentLogItemWithChildren, NodeTracing } from '@/types/workflow'

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
    if (item.node_type === BlockEnum.Agent && item.execution_metadata?.agent_log && item.execution_metadata?.agent_log.length > 0)
      item.agentLog = listToTree(item.execution_metadata.agent_log)

    return item
  })

  return result
}

export default format
