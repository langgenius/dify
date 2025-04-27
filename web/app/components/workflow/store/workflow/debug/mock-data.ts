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

export const conversationVars: VarInInspect[] = [
  {
    id: 'con1',
    type: VarInInspectType.conversation,
    name: 'conversationVar 1',
    description: '',
    selector: ['conversation', 'var1'],
    value_type: VarType.string,
    value: 'conversation var value...',
    edited: false,
  },
]

export const systemVars: VarInInspect[] = [
  {
    id: 'sys1',
    type: VarInInspectType.system,
    name: 'query',
    description: '',
    selector: ['sys', 'query'],
    value_type: VarType.string,
    value: 'Hello robot!',
    edited: false,
  },
]
