import type { NodeTracing } from '@/types/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import formatParallelNode from '../parallel'

export function addChildrenToLoopNode(loopNode: NodeTracing, childrenNodes: NodeTracing[]): NodeTracing {
  const details: NodeTracing[][] = []
  childrenNodes.forEach((item) => {
    if (!item.execution_metadata)
      return
    const { parallel_mode_run_id, loop_index = 0 } = item.execution_metadata
    const runIndex: number = (parallel_mode_run_id || loop_index) as number
    if (!details[runIndex])
      details[runIndex] = []

    details[runIndex].push(item)
  })
  return {
    ...loopNode,
    details,
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
