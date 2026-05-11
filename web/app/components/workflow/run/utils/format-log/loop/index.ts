import type { NodeTracing } from '@/types/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import formatParallelNode from '../parallel'

export function addChildrenToLoopNode(loopNode: NodeTracing, childrenNodes: NodeTracing[]): NodeTracing {
  const detailsByKey = new Map<string, NodeTracing[]>()
  let lastResolvedIndex = -1
  const order: string[] = []

  const ensureGroup = (key: string) => {
    const group = detailsByKey.get(key)
    if (group)
      return group

    const newGroup: NodeTracing[] = []
    detailsByKey.set(key, newGroup)
    order.push(key)
    return newGroup
  }

  childrenNodes.forEach((item) => {
    if (!item.execution_metadata)
      return
    const { parallel_mode_run_id, loop_index } = item.execution_metadata
    let runIndex: number | string

    if (parallel_mode_run_id !== undefined) {
      runIndex = parallel_mode_run_id
    }
    else if (loop_index !== undefined) {
      runIndex = loop_index
    }
    else if (lastResolvedIndex >= 0) {
      const currentGroup = detailsByKey.get(String(lastResolvedIndex)) || []
      const seenSameNodeInCurrentGroup = currentGroup.some(node => node.node_id === item.node_id)
      runIndex = seenSameNodeInCurrentGroup ? lastResolvedIndex + 1 : lastResolvedIndex
    }
    else {
      runIndex = 0
    }

    ensureGroup(String(runIndex)).push(item)
    if (typeof runIndex === 'number')
      lastResolvedIndex = runIndex
  })
  return {
    ...loopNode,
    details: order.map(key => detailsByKey.get(key) || []),
  }
}

const format = (list: NodeTracing[], t: any): NodeTracing[] => {
  const loopNodeIds = list
    .filter(item => item.node_type === BlockEnum.Loop)
    .map(item => item.node_id)
  const loopChildrenNodeIds = list
    .filter(item => item.execution_metadata?.loop_id && loopNodeIds.includes(item.execution_metadata.loop_id))
    .map(item => item.node_id)
  // move loop children nodes to loop node's details field
  const result = list
    .filter(item => !loopChildrenNodeIds.includes(item.node_id))
    .map((item) => {
      if (item.node_type === BlockEnum.Loop) {
        const childrenNodes = list.filter(child => child.execution_metadata?.loop_id === item.node_id)
        const error = childrenNodes.find(child => child.status === 'failed')
        if (error) {
          item.status = 'failed'
          item.error = error.error
        }
        const addedChildrenList = addChildrenToLoopNode(item, childrenNodes)
        // handle parallel node in loop node
        if (addedChildrenList.details && addedChildrenList.details.length > 0) {
          addedChildrenList.details = addedChildrenList.details.map((row) => {
            return formatParallelNode(row, t)
          })
        }
        return addedChildrenList
      }

      return item
    })

  return result
}

export default format
