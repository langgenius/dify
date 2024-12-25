import type { NodeTracing } from '@/types/workflow'
import { BlockEnum } from '../../../types'

type IterationNodeId = string
type RunIndex = string
type IterationGroupMap = Map<IterationNodeId, Map<RunIndex, NodeTracing[]>>

const processIterationNode = (item: NodeTracing) => {
  return {
    ...item,
    details: [], // to add the sub nodes in the iteration
  }
}

const updateParallelModeGroup = (nodeGroupMap: IterationGroupMap, runIndex: string, item: NodeTracing, iterationNode: NodeTracing) => {
  if (!nodeGroupMap.has(iterationNode.node_id))
    nodeGroupMap.set(iterationNode.node_id, new Map())

  const groupMap = nodeGroupMap.get(iterationNode.node_id)!

  if (!groupMap.has(runIndex))
    groupMap.set(runIndex, [item])

  else
    groupMap.get(runIndex)!.push(item)

  if (item.status === 'failed') {
    iterationNode.status = 'failed'
    iterationNode.error = item.error
  }

  iterationNode.details = Array.from(groupMap.values())
}

const updateSequentialModeGroup = (runIndex: number, item: NodeTracing, iterationNode: NodeTracing) => {
  const { details } = iterationNode
  if (details) {
    if (!details[runIndex])
      details[runIndex] = [item]
    else
      details[runIndex].push(item)
  }

  if (item.status === 'failed') {
    iterationNode.status = 'failed'
    iterationNode.error = item.error
  }
}

const addRetryDetail = (result: NodeTracing[], item: NodeTracing) => {
  const retryNode = result.find(node => node.node_id === item.node_id)

  if (retryNode) {
    if (retryNode?.retryDetail)
      retryNode.retryDetail.push(item)
    else
      retryNode.retryDetail = [item]
  }
}

const processNonIterationNode = (result: NodeTracing[], nodeGroupMap: IterationGroupMap, item: NodeTracing) => {
  const { execution_metadata } = item
  if (!execution_metadata?.iteration_id) {
    if (item.status === 'retry') {
      addRetryDetail(result, item)
      return
    }
    result.push(item)
    return
  }

  const parentIterationNode = result.find(node => node.node_id === execution_metadata.iteration_id)
  const isInIteration = !!parentIterationNode && Array.isArray(parentIterationNode.details)
  if (!isInIteration)
    return

  // the parallel in the iteration in mode.
  const { parallel_mode_run_id, iteration_index = 0 } = execution_metadata
  const isInParallel = !!parallel_mode_run_id

  if (isInParallel)
    updateParallelModeGroup(nodeGroupMap, parallel_mode_run_id, item, parentIterationNode)
  else
    updateSequentialModeGroup(iteration_index, item, parentIterationNode)
}

// list => tree. Put the iteration node's children into the details field.
const formatToTracingNodeList = (list: NodeTracing[]) => {
  const allItems = [...list].reverse()
  const result: NodeTracing[] = []
  const iterationGroupMap = new Map<string, Map<string, NodeTracing[]>>()

  allItems.forEach((item) => {
    item.node_type === BlockEnum.Iteration
      ? result.push(processIterationNode(item))
      : processNonIterationNode(result, iterationGroupMap, item)
  })

  // console.log(allItems)
  // console.log(result)

  return result
}

export default formatToTracingNodeList
