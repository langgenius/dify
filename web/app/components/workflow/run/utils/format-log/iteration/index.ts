import type { NodeTracing } from '@/types/workflow'
import { NodeRunningStatus } from '@/app/components/workflow/types'

export function addChildrenToIterationNode(
  iterationNode: NodeTracing,
  childrenNodes: NodeTracing[],
): NodeTracing {
  const details: NodeTracing[][] = []
  let lastResolvedIndex = -1

  childrenNodes.forEach((item) => {
    if (!item.execution_metadata) return
    const { iteration_index } = item.execution_metadata
    let runIndex: number

    if (iteration_index !== undefined) {
      runIndex = iteration_index
    } else if (lastResolvedIndex >= 0) {
      const currentGroup = details[lastResolvedIndex] || []
      const seenSameNodeInCurrentGroup = currentGroup.some((node) => node.node_id === item.node_id)
      runIndex = seenSameNodeInCurrentGroup ? lastResolvedIndex + 1 : lastResolvedIndex
    } else {
      runIndex = 0
    }

    if (!details[runIndex]) details[runIndex] = []

    details[runIndex]!.push(item)
    lastResolvedIndex = runIndex
  })
  return {
    ...iterationNode,
    details,
  }
}

export const getIterationDurationMap = (nodeInfo: NodeTracing) => {
  return nodeInfo.iterDurationMap || nodeInfo.execution_metadata?.iteration_duration_map || {}
}

export const getIterationResultList = (nodeInfo: NodeTracing, allExecutions?: NodeTracing[]) => {
  const getNodesForInstance = (key: string): NodeTracing[] => {
    if (!allExecutions) return []

    const parallelNodes = allExecutions.filter(
      (exec) => exec.execution_metadata?.parallel_mode_run_id === key,
    )
    if (parallelNodes.length > 0) return parallelNodes

    const serialIndex = Number.parseInt(key, 10)
    if (!Number.isNaN(serialIndex)) {
      const serialNodes = allExecutions.filter(
        (exec) =>
          exec.execution_metadata?.iteration_id === nodeInfo.node_id &&
          exec.execution_metadata?.iteration_index === serialIndex,
      )
      if (serialNodes.length > 0) return serialNodes
    }

    return []
  }

  const iterationNodeMeta = nodeInfo.execution_metadata

  if (!iterationNodeMeta?.iteration_duration_map) return nodeInfo.details || []

  const structuredList = Object.keys(iterationNodeMeta.iteration_duration_map)
    .map(getNodesForInstance)
    .filter((branchNodes) => branchNodes.length > 0)

  if (!allExecutions || !nodeInfo.details?.length) return structuredList

  const existingIterationIndices = new Set<number>()
  structuredList.forEach((iteration) => {
    iteration.forEach((node) => {
      if (node.execution_metadata?.iteration_index !== undefined)
        existingIterationIndices.add(node.execution_metadata.iteration_index)
    })
  })

  nodeInfo.details.forEach((iteration, index) => {
    if (
      !existingIterationIndices.has(index) &&
      iteration.some((node) => node.status === NodeRunningStatus.Failed)
    ) {
      structuredList.push(iteration)
    }
  })

  return structuredList.sort((a, b) => {
    const aIndex = a[0]?.execution_metadata?.iteration_index ?? 0
    const bIndex = b[0]?.execution_metadata?.iteration_index ?? 0
    return aIndex - bIndex
  })
}
