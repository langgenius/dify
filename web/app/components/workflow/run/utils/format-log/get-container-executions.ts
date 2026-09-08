import type { NodeTracing } from '@/types/workflow'

export const getContainerExecutions = (
  key: string,
  node: NodeTracing,
  nodeType: 'iteration' | 'loop',
  executions: NodeTracing[] = [],
) => {
  const parallelExecutions = executions.filter(
    (execution) => execution.execution_metadata?.parallel_mode_run_id === key,
  )
  if (parallelExecutions.length) return parallelExecutions

  const index = Number.parseInt(key, 10)
  if (Number.isNaN(index)) return []

  return executions.filter(
    (execution) =>
      execution.execution_metadata?.[`${nodeType}_id`] === node.node_id &&
      execution.execution_metadata?.[`${nodeType}_index`] === index,
  )
}
