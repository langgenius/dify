import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { VarInInspectType } from '@/types/workflow'
import type { BlockEnum } from '../types'
import { VarType } from '../types'

type OutputToVarInInspectParams = {
  nodeId: string
  name: string
  value: any
}
export const outputToVarInInspect = ({
  nodeId,
  name,
  value,
}: OutputToVarInInspectParams): VarInInspect => {
  return {
    id: `${Date.now()}`, // TODO: wait for api
    type: VarInInspectType.node,
    name,
    description: '',
    selector: [nodeId, name],
    value_type: VarType.string, // TODO: wait for api or get from node
    value,
    edited: false,
  }
}

type NodeWithVarParams = {
  nodeId: string
  nodeType: BlockEnum
  title: string
  values: Record<string, any>
}
export const getNodeWithVar = ({
  nodeId,
  nodeType,
  title,
  values,
}: NodeWithVarParams): NodeWithVar => {
  const res: NodeWithVar = {
    nodeId,
    nodeType,
    title,
    vars: [],
  }

  res.vars = Object.entries(values).map(([key, value]) => {
    return outputToVarInInspect({
      nodeId,
      name: key,
      value,
    })
  })

  return res
}
