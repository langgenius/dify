import type { NodeTracing } from '@/types/workflow'

export function addChildrenToLoopNode(
  loopNode: NodeTracing,
  childrenNodes: NodeTracing[],
): NodeTracing {
  const detailsByKey = new Map<string, NodeTracing[]>()
  let lastResolvedIndex = -1
  const order: string[] = []

  const ensureGroup = (key: string) => {
    const group = detailsByKey.get(key)
    if (group) return group

    const newGroup: NodeTracing[] = []
    detailsByKey.set(key, newGroup)
    order.push(key)
    return newGroup
  }

  childrenNodes.forEach((item) => {
    if (!item.execution_metadata) return
    const { parallel_mode_run_id, loop_index } = item.execution_metadata
    let runIndex: number | string

    if (parallel_mode_run_id !== undefined) {
      runIndex = parallel_mode_run_id
    } else if (loop_index !== undefined) {
      runIndex = loop_index
    } else if (lastResolvedIndex >= 0) {
      const currentGroup = detailsByKey.get(String(lastResolvedIndex)) || []
      const seenSameNodeInCurrentGroup = currentGroup.some((node) => node.node_id === item.node_id)
      runIndex = seenSameNodeInCurrentGroup ? lastResolvedIndex + 1 : lastResolvedIndex
    } else {
      runIndex = 0
    }

    ensureGroup(String(runIndex)).push(item)
    if (typeof runIndex === 'number') lastResolvedIndex = runIndex
  })
  return {
    ...loopNode,
    details: order.map((key) => detailsByKey.get(key) || []),
  }
}
