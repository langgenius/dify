import type { VarInInspect } from '@/types/workflow'
import { VarInInspectType } from '@/types/workflow'
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
    visible: true,
    is_truncated: false,
    full_content: { size_bytes: 0, download_url: '' },
  }
}
