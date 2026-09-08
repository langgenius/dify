import type { NodeTracing } from '@/types/workflow'

export const getContainerExecutions = (
  key: string,
  node: NodeTracing,
  type: 'iteration' | 'loop',
  executions: NodeTracing[] = [],
) => {
  const parallel = executions.filter(
    (execution) => execution.execution_metadata?.parallel_mode_run_id === key,
  )
  if (parallel.length) return parallel

  const index = Number.parseInt(key, 10)
  if (Number.isNaN(index)) return []

  return executions.filter(
    (execution) =>
      execution.execution_metadata?.[`${type}_id`] === node.node_id &&
      execution.execution_metadata?.[`${type}_index`] === index,
  )
}
