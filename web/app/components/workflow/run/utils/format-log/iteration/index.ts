import type { NodeTracing } from '@/types/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import formatParallelNode from '../parallel'

export function addChildrenToIterationNode(iterationNode: NodeTracing, childrenNodes: NodeTracing[]): NodeTracing {
  const details: NodeTracing[][] = []
  let lastResolvedIndex = -1

  childrenNodes.forEach((item) => {
    if (!item.execution_metadata)
      return
    const { iteration_index } = item.execution_metadata
    let runIndex: number

    if (iteration_index !== undefined) {
      runIndex = iteration_index
    }
    else if (lastResolvedIndex >= 0) {
      const currentGroup = details[lastResolvedIndex] || []
      const seenSameNodeInCurrentGroup = currentGroup.some(node => node.node_id === item.node_id)
      runIndex = seenSameNodeInCurrentGroup ? lastResolvedIndex + 1 : lastResolvedIndex
    }
    else {
      runIndex = 0
    }

    if (!details[runIndex])
      details[runIndex] = []

    details[runIndex]!.push(item)
    lastResolvedIndex = runIndex
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
