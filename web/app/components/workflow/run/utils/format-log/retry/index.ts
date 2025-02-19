import type { NodeTracing } from '@/types/workflow'

const format = (list: NodeTracing[]): NodeTracing[] => {
  const retryNodes = list.filter((item) => {
    return item.status === 'retry'
  })

  const retryNodeIds = retryNodes.map(item => item.node_id)
  // move retry nodes to retryDetail
  const result = list.filter((item) => {
    return item.status !== 'retry'
  }).map((item) => {
    const { execution_metadata } = item
    const isInIteration = !!execution_metadata?.iteration_id
    const nodeId = item.node_id
    const isRetryBelongNode = retryNodeIds.includes(nodeId)

    if (isRetryBelongNode) {
      return {
        ...item,
        retryDetail: retryNodes.filter((node) => {
          if (!isInIteration)
            return node.node_id === nodeId

          // retry node in iteration
          return node.node_id === nodeId && node.execution_metadata?.iteration_index === execution_metadata?.iteration_index
        }),
      }
    }
    return item
  })
  return result
}

export default format
