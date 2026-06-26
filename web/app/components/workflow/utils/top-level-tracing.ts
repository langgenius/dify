import type { NodeTracing } from '@/types/workflow'

export const findParallelTraceIndex = (
  tracing: Partial<NodeTracing>[],
  data: Partial<NodeTracing>,
) => {
  return tracing.findIndex((item) => {
    if (item.id === data.id)
      return true

    if (item.node_id === data.node_id) {
      const itemParallelId = item.execution_metadata?.parallel_id || item.parallel_id
      const dataParallelId = data.execution_metadata?.parallel_id || data.parallel_id

      if (!itemParallelId && !dataParallelId)
        return true

      return itemParallelId === dataParallelId
    }

    return false
  })
}
