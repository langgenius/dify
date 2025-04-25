import { VarType } from '../../../types'
import type { VarInInspect } from '@/types/workflow'
import { VarInInspectType } from '@/types/workflow'

export const vars: VarInInspect[] = [
  {
    id: 'xxx',
    type: VarInInspectType.node,
    name: 'llm 2',
    description: '',
    selector: ['1745476079387', 'text'],
    value_type: VarType.string,
    value: 'text value...',
    edited: false,
  },
]
