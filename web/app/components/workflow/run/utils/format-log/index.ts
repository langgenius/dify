import type { NodeTracing } from '@/types/workflow'
import formatIterationNode from './iteration'
import formatParallelNode from './parallel'
import formatRetryNode from './retry'
import formatAgentNode from './agent'
import { cloneDeep } from 'lodash-es'

const formatToTracingNodeList = (list: NodeTracing[], t: any) => {
  const allItems = cloneDeep([...list]).sort((a, b) => a.index - b.index)
  /*
  * First handle not change list structure node
  * Because Handle struct node will put the node in different
  */
  const formattedAgentList = formatAgentNode(allItems)
  const formattedRetryList = formatRetryNode(formattedAgentList) // retry one node
  // would change the structure of the list. Iteration and parallel can include each other.
  const formattedIterationList = formatIterationNode(formattedRetryList, t)
  const formattedParallelList = formatParallelNode(formattedIterationList, t)

  const result = formattedParallelList
  // console.log(allItems)
  // console.log(result)

  return result
}

export default formatToTracingNodeList
