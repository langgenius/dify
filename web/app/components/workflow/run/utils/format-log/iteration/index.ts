import type { NodeTracing } from '@/types/workflow'

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
