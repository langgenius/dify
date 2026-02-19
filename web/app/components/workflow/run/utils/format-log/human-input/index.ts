import type { NodeTracing } from '@/types/workflow'
import { BlockEnum } from '@/app/components/workflow/types'

/**
 * Format human-input nodes to ensure only the latest status is kept for each node.
 * Human-input nodes can have multiple log entries as their status changes
 * (e.g., running -> paused -> succeeded/failed).
 * This function keeps only the entry with the latest index for each unique node_id.
 */
const formatHumanInputNode = (list: NodeTracing[]): NodeTracing[] => {
  // Group human-input nodes by node_id
  const humanInputNodeMap = new Map<string, NodeTracing>()

  // Track which node_ids are human-input type
  const humanInputNodeIds = new Set<string>()

  // First pass: identify human-input nodes and keep the one with the highest index
  list.forEach((item) => {
    if (item.node_type === BlockEnum.HumanInput) {
      humanInputNodeIds.add(item.node_id)

      const existingNode = humanInputNodeMap.get(item.node_id)
      if (!existingNode || item.index > existingNode.index) {
        humanInputNodeMap.set(item.node_id, item)
      }
    }
  })

  // If no human-input nodes, return the list as is
  if (humanInputNodeIds.size === 0)
    return list

  // Second pass: filter the list to remove duplicate human-input nodes
  // and keep only the latest one for each node_id
  const result: NodeTracing[] = []
  const addedHumanInputNodeIds = new Set<string>()

  list.forEach((item) => {
    if (item.node_type === BlockEnum.HumanInput) {
      // Only add the human-input node with the highest index
      if (!addedHumanInputNodeIds.has(item.node_id)) {
        const latestNode = humanInputNodeMap.get(item.node_id)
        if (latestNode) {
          result.push(latestNode)
          addedHumanInputNodeIds.add(item.node_id)
        }
      }
      // Skip duplicate human-input nodes
    }
    else {
      // Keep all non-human-input nodes
      result.push(item)
    }
  })

  return result
}

export default formatHumanInputNode
