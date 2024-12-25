import { BlockEnum } from '@/app/components/workflow/types'
import type { NodeTracing } from '@/types/workflow'

function addChildrenToIterationNode(iterationNode: NodeTracing, childrenNodes: NodeTracing[]): NodeTracing {
  const details: NodeTracing[][] = []
  childrenNodes.forEach((item) => {
    if (!item.execution_metadata) return
    const { parallel_mode_run_id, iteration_index = 0 } = item.execution_metadata
    const runIndex: number = (parallel_mode_run_id || iteration_index) as number
    if (!details[runIndex])
      details[runIndex] = []

    details[runIndex].push(item)
  })
  return {
    ...iterationNode,
    details,
  }
}

const format = (list: NodeTracing[]): NodeTracing[] => {
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
        return addChildrenToIterationNode(item, childrenNodes)
      }

      return item
    })

  return result
}

export default format
