import { BlockEnum } from '@/app/components/workflow/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'

const formatItem = (item: any): NodeOutPutVar => {
  const { id, data } = item
  const res: NodeOutPutVar = {
    nodeId: id,
    title: data.title,
    vars: [],
  }
  switch (data.type) {
    case BlockEnum.Start: {
      const {
        variables,
      } = data as StartNodeType
      res.vars = variables.map((v) => {
        return {
          variable: v.variable,
          type: v.type,
        }
      })
      break
    }

    // default:
    //   // throw new Error('unknown type')
    //   break
  }

  return res
}
export const toNodeOutputVars = (nodes: any[]): NodeOutPutVar[] => {
  return nodes.map(formatItem)
}
