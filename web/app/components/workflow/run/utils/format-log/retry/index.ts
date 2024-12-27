import { BlockEnum } from '@/app/components/workflow/types'
import type { NodeTracing } from '@/types/workflow'

const format = (list: NodeTracing[]): NodeTracing[] => {
  const retryNodes = list.filter((item) => {
    const { execution_metadata } = item
    const isInIteration = !!execution_metadata?.iteration_id
    if (isInIteration || item.node_type === BlockEnum.Iteration) return false
    return item.status === 'retry'
  })

  const retryNodeIds = retryNodes.map(item => item.node_id)
  // move retry nodes to retryDetail
  const result = list.filter((item) => {
    return item.status !== 'retry'
  }).map((item) => {
    const isRetryBelongNode = retryNodeIds.includes(item.node_id)
    if (isRetryBelongNode) {
      return {
        ...item,
        retryDetail: list.filter(node => node.status === 'retry' && node.node_id === item.node_id),
      }
    }
    return item
  })
  return result
}

export default format
