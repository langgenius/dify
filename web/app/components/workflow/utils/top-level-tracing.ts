import type { NodeTracing } from '@/types/workflow'

const isNestedTracingNode = (trace: Pick<NodeTracing, 'iteration_id' | 'loop_id'>) => {
  return Boolean(trace.iteration_id || trace.loop_id)
}

export const upsertTopLevelTracingNodeOnStart = (
  tracing: NodeTracing[],
  startedNode: NodeTracing,
) => {
  if (isNestedTracingNode(startedNode))
    return false

  const currentIndex = startedNode.id
    ? tracing.findIndex(item => item.id === startedNode.id)
    : tracing.findIndex(item => item.node_id === startedNode.node_id)
  if (currentIndex > -1)
    // Started events are the authoritative snapshot for an execution; merging would retain stale client-side fields.
    tracing[currentIndex] = startedNode
  else
    tracing.push(startedNode)

  return true
}
