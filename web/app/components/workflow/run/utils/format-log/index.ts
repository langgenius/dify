import type { NodeTracing } from '@/types/workflow'
import formatIterationNode from './iteration'
import formatRetryNode from './retry'
import formatAgentNode from './agent'

const formatToTracingNodeList = (list: NodeTracing[]) => {
  const allItems = [...list].reverse()
  const formattedIterationList = formatIterationNode(allItems)
  const formattedRetryList = formatRetryNode(formattedIterationList)
  const formattedAgentList = formatAgentNode(formattedRetryList)

  const result = formattedAgentList
  // console.log(allItems)
  // console.log(result)

  return result
}

export default formatToTracingNodeList
