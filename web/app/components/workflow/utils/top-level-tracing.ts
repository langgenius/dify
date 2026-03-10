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
    tracing[currentIndex] = startedNode
  else
    tracing.push(startedNode)

  return true
}
