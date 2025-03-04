import type { NodeTracing } from '@/types/workflow'
import formatIterationNode from './iteration'
import formatLoopNode from './loop'
import formatParallelNode from './parallel'
import formatRetryNode from './retry'
import formatAgentNode from './agent'
import { cloneDeep } from 'lodash-es'
import { BlockEnum } from '../../../types'
import { orderBy } from 'lodash-es'

const formatToTracingNodeList = (list: NodeTracing[], t: any) => {
  const allItems = cloneDeep([...list]).sort((a, b) => a.index - b.index)
  const loopRelatedListIds = allItems.filter(item => (!!item.execution_metadata?.loop_id || item.node_type === BlockEnum.Loop)).map(x => x.id)
  /*
  * First handle not change list structure node
  * Because Handle struct node will put the node in different
  */
  const formattedAgentList = formatAgentNode(allItems)
  const formattedRetryList = formatRetryNode(formattedAgentList) // retry one node
  // would change the structure of the list. Iteration and parallel can include each other.
  const formattedIterationList = formatIterationNode(formattedRetryList.filter(item => !loopRelatedListIds.includes(item.id)), t)
  const formattedLoopList = formatLoopNode(formattedRetryList.filter(item => loopRelatedListIds.includes(item.id)), t)
  const orderedNodeList = orderBy([...formattedIterationList, ...formattedLoopList], 'finished_at', 'asc')
  const formattedParallelList = formatParallelNode(orderedNodeList, t)

  const result = formattedParallelList
  // console.log(allItems)
  // console.log(result)

  return result
}

export default formatToTracingNodeList
