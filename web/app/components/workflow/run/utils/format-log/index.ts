import type { NodeTracing } from '@/types/workflow'
import { addChildrenToIterationNode } from './iteration'
import { addChildrenToLoopNode } from './loop'
import formatParallelNode from './parallel'
import formatRetryNode from './retry'
import formatAgentNode from './agent'
import { cloneDeep } from 'lodash-es'
import { BlockEnum } from '../../../types'

const formatIterationAndLoopNode = (list: NodeTracing[], t: any) => {
  const clonedList = cloneDeep(list)

  // Identify all loop and iteration nodes
  const loopNodeIds = clonedList
    .filter(item => item.node_type === BlockEnum.Loop)
    .map(item => item.node_id)

  const iterationNodeIds = clonedList
    .filter(item => item.node_type === BlockEnum.Iteration)
    .map(item => item.node_id)

  // Identify all child nodes for both loop and iteration
  const loopChildrenNodeIds = clonedList
    .filter(item => item.execution_metadata?.loop_id && loopNodeIds.includes(item.execution_metadata.loop_id))
    .map(item => item.node_id)

  const iterationChildrenNodeIds = clonedList
    .filter(item => item.execution_metadata?.iteration_id && iterationNodeIds.includes(item.execution_metadata.iteration_id))
    .map(item => item.node_id)

  // Filter out child nodes as they will be included in their parent nodes
  const result = clonedList
    .filter(item => !loopChildrenNodeIds.includes(item.node_id) && !iterationChildrenNodeIds.includes(item.node_id))
    .map((item) => {
      // Process Loop nodes
      if (item.node_type === BlockEnum.Loop) {
        const childrenNodes = clonedList.filter(child => child.execution_metadata?.loop_id === item.node_id)
        const error = childrenNodes.find(child => child.status === 'failed')
        if (error) {
          item.status = 'failed'
          item.error = error.error
        }
        const addedChildrenList = addChildrenToLoopNode(item, childrenNodes)

        // Handle parallel nodes in loop node
        if (addedChildrenList.details && addedChildrenList.details.length > 0) {
          addedChildrenList.details = addedChildrenList.details.map((row) => {
            return formatParallelNode(row, t)
          })
        }
        return addedChildrenList
      }

      // Process Iteration nodes
      if (item.node_type === BlockEnum.Iteration) {
        const childrenNodes = clonedList.filter(child => child.execution_metadata?.iteration_id === item.node_id)
        const error = childrenNodes.find(child => child.status === 'failed')
        if (error) {
          item.status = 'failed'
          item.error = error.error
        }
        const addedChildrenList = addChildrenToIterationNode(item, childrenNodes)

        // Handle parallel nodes in iteration node
        if (addedChildrenList.details && addedChildrenList.details.length > 0) {
          addedChildrenList.details = addedChildrenList.details.map((row) => {
            return formatParallelNode(row, t)
          })
        }
        return addedChildrenList
      }

      return item
    })

  return result
}

const formatToTracingNodeList = (list: NodeTracing[], t: any) => {
  const allItems = cloneDeep([...list]).sort((a, b) => a.index - b.index)
  /*
  * First handle not change list structure node
  * Because Handle struct node will put the node in different
  */
  const formattedAgentList = formatAgentNode(allItems)
  const formattedRetryList = formatRetryNode(formattedAgentList) // retry one node
  // would change the structure of the list. Iteration and parallel can include each other.
  const formattedLoopAndIterationList = formatIterationAndLoopNode(formattedRetryList, t)
  const formattedParallelList = formatParallelNode(formattedLoopAndIterationList, t)

  const result = formattedParallelList
  // console.log(allItems)
  // console.log(result)

  return result
}

export default formatToTracingNodeList
