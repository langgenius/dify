import type { NodeTracing } from '@/types/workflow'
import { NodeRunningStatus } from '../types'

const isNestedTracingNode = (trace: Pick<NodeTracing, 'iteration_id' | 'loop_id'>) => {
  return Boolean(trace.iteration_id || trace.loop_id)
}

export const upsertTopLevelTracingNodeOnStart = (
  tracing: NodeTracing[],
  startedNode: NodeTracing,
) => {
  if (isNestedTracingNode(startedNode))
    return false

  const currentIndex = tracing.findIndex((item) => {
    if (item.id === startedNode.id)
      return true

    return item.node_id === startedNode.node_id && item.status === NodeRunningStatus.Running
  })
  if (currentIndex > -1)
    // Started events are the authoritative snapshot for an execution; merging would retain stale client-side fields.
    tracing[currentIndex] = startedNode
  else
    tracing.push(startedNode)

  return true
}
