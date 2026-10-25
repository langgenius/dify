import type { NodeTracing } from '@/types/workflow'
import { BlockEnum } from '@/app/components/workflow/types'

/** Keep the latest status of each approval without merging separate container executions. */
const formatHumanInputNode = (list: NodeTracing[]): NodeTracing[] => {
  const result: NodeTracing[] = []
  const humanInputPositions = new Map<string, number>()

  list.forEach((item) => {
    if (item.node_type !== BlockEnum.HumanInput) {
      result.push(item)
      return
    }

    const metadata = item.execution_metadata
    const inLoopOrIteration =
      item.iteration_id || item.loop_id || metadata?.iteration_id || metadata?.loop_id
    // Legacy top-level traces may use different row IDs for successive statuses.
    // Container execution IDs survive pause/resume and distinguish repeated approvals.
    const key = item.node_execution_id ?? (inLoopOrIteration ? item.id : item.node_id)
    const index = humanInputPositions.get(key)
    if (index === undefined) {
      humanInputPositions.set(key, result.length)
      result.push(item)
    } else if (item.index > result[index]!.index) {
      result[index] = item
    }
  })

  return result
}

export default formatHumanInputNode
