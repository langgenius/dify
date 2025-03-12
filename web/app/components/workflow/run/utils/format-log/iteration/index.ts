import { BlockEnum } from '@/app/components/workflow/types'
import type { NodeTracing } from '@/types/workflow'
import formatParallelNode from '../parallel'

export function addChildrenToIterationNode(iterationNode: NodeTracing, childrenNodes: NodeTracing[]): NodeTracing {
  const details: NodeTracing[][] = []
  childrenNodes.forEach((item, index) => {
    if (!item.execution_metadata) return
    const { iteration_index = 0 } = item.execution_metadata
    const runIndex: number = iteration_index !== undefined ? iteration_index : index
    if (!details[runIndex])
      details[runIndex] = []

    details[runIndex].push(item)
  })
  return {
    ...iterationNode,
    details,
  }
}

const format = (list: NodeTracing[], t: any): NodeTracing[] => {
  const iterationNodeIds = list
    .filter(item => item.node_type === BlockEnum.Iteration)
    .map(item => item.node_id)
  const iterationChildrenNodeIds = list
    .filter(item => item.execution_metadata?.iteration_id && iterationNodeIds.includes(item.execution_metadata.iteration_id))
    .map(item => item.node_id)
  // move iteration children nodes to iteration node's details field
  const result = list
    .filter(item => !iterationChildrenNodeIds.includes(item.node_id))
    .map((item) => {
      if (item.node_type === BlockEnum.Iteration) {
        const childrenNodes = list.filter(child => child.execution_metadata?.iteration_id === item.node_id)
        const error = childrenNodes.find(child => child.status === 'failed')
        if (error) {
          item.status = 'failed'
          item.error = error.error
        }
        const addedChildrenList = addChildrenToIterationNode(item, childrenNodes)
        // handle parallel node in iteration node
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
