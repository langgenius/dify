import type { NodeTracing } from '@/types/workflow'
import formatIterationNode from './iteration'
import formatLoopNode from './loop'
import formatParallelNode from './parallel'
import formatRetryNode from './retry'
import formatAgentNode from './agent'
import { cloneDeep } from 'lodash-es'
import { BlockEnum } from '../../../types'

const formatToTracingNodeList = (list: NodeTracing[], t: any) => {
  const allItems = cloneDeep([...list]).sort((a, b) => a.index - b.index)
  const loopRelatedList = allItems.filter(item => (item.execution_metadata?.loop_id || item.node_type === BlockEnum.Loop))
  /*
  * First handle not change list structure node
  * Because Handle struct node will put the node in different
  */
  const formattedAgentList = formatAgentNode(allItems)
  const formattedRetryList = formatRetryNode(formattedAgentList) // retry one node
  // would change the structure of the list. Iteration and parallel can include each other.
  const formattedIterationList = formatIterationNode(formattedRetryList.filter(item => !loopRelatedList.includes(item)), t)
  const formattedLoopList = formatLoopNode(loopRelatedList, t)
  const formattedParallelList = formatParallelNode([...formattedIterationList, ...formattedLoopList], t)

  const result = formattedParallelList
  // console.log(allItems)
  // console.log(result)

  return result
}

export default formatToTracingNodeList
