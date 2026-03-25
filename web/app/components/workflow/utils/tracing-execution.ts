import type { NodeTracing } from '@/types/workflow'

type TracingLookup = {
  executionId?: string
  nodeId?: string
  parallelId?: string
  allowNodeIdFallbackWhenExecutionIdMissing?: boolean
}

const getParallelId = (trace: Partial<NodeTracing>) => {
  return trace.execution_metadata?.parallel_id || trace.parallel_id
}

export const findTracingIndexByExecutionOrUniqueNodeId = (
  tracing: Partial<NodeTracing>[],
  { executionId, nodeId, parallelId, allowNodeIdFallbackWhenExecutionIdMissing = true }: TracingLookup,
) => {
  if (executionId) {
    const exactIndex = tracing.findIndex(item => item.id === executionId)
    if (exactIndex > -1)
      return exactIndex

    if (!allowNodeIdFallbackWhenExecutionIdMissing)
      return -1
  }

  if (!nodeId)
    return -1

  const candidates = tracing
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.node_id === nodeId)
    .filter(({ item }) => !parallelId || getParallelId(item) === parallelId)

  return candidates.length === 1 ? candidates[0].index : -1
}

export const upsertTracingNodeOnResumeStart = (
  tracing: NodeTracing[],
  startedNode: NodeTracing,
) => {
  const currentIndex = findTracingIndexByExecutionOrUniqueNodeId(tracing, {
    executionId: startedNode.id,
    nodeId: startedNode.node_id,
    parallelId: getParallelId(startedNode),
    allowNodeIdFallbackWhenExecutionIdMissing: false,
  })

  if (currentIndex > -1) {
    tracing[currentIndex] = {
      ...tracing[currentIndex],
      ...startedNode,
    }
    return currentIndex
  }

  tracing.push(startedNode)
  return tracing.length - 1
}

export const mergeTracingNodePreservingExecutionMetadata = (
  currentNode: NodeTracing,
  incomingNode: Partial<NodeTracing>,
): NodeTracing => {
  return {
    ...currentNode,
    ...incomingNode,
    execution_metadata: incomingNode.execution_metadata
      ? {
          ...currentNode.execution_metadata,
          ...incomingNode.execution_metadata,
          agent_log: incomingNode.execution_metadata.agent_log ?? currentNode.execution_metadata?.agent_log,
        }
      : currentNode.execution_metadata,
  }
}
