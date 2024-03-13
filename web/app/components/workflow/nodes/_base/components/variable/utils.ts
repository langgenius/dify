import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { LLM_OUTPUT_STRUCT, SUPPORT_OUTPUT_VARS_NODE } from '@/app/components/workflow/constants'

const inputVarTypeToVarType = (type: InputVarType): VarType => {
  if (type === InputVarType.number)
    return VarType.number

  return VarType.string
}

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
          type: inputVarTypeToVarType(v.type),
        }
      })
      break
    }

    case BlockEnum.LLM: {
      res.vars = LLM_OUTPUT_STRUCT
      break
    }
  }

  return res
}
export const toNodeOutputVars = (nodes: any[]): NodeOutPutVar[] => {
  return nodes.filter(node => SUPPORT_OUTPUT_VARS_NODE.includes(node.data.type)).map(formatItem)
}
