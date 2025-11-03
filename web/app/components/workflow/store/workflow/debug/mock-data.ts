import { VarType } from '../../../types'
import type { VarInInspect } from '@/types/workflow'
import { VarInInspectType } from '@/types/workflow'

export const vars: VarInInspect[] = [
  {
    id: 'xxx',
    type: VarInInspectType.node,
    name: 'text00',
    description: '',
    selector: ['1745476079387', 'text'],
    value_type: VarType.string,
    value: 'text value...',
    edited: false,
    visible: true,
    is_truncated: false,
    full_content: { size_bytes: 0, download_url: '' },
  },
  {
    id: 'fdklajljgldjglkagjlk',
    type: VarInInspectType.node,
    name: 'text',
    description: '',
    selector: ['1712386917734', 'text'],
    value_type: VarType.string,
    value: 'made zhizhang',
    edited: false,
    visible: true,
    is_truncated: false,
    full_content: { size_bytes: 0, download_url: '' },
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
    visible: true,
    is_truncated: false,
    full_content: { size_bytes: 0, download_url: '' },
  },
  {
    id: 'con2',
    type: VarInInspectType.conversation,
    name: 'conversationVar 2',
    description: '',
    selector: ['conversation', 'var2'],
    value_type: VarType.number,
    value: 456,
    edited: false,
    visible: true,
    is_truncated: false,
    full_content: { size_bytes: 0, download_url: '' },
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
    visible: true,
    is_truncated: false,
    full_content: { size_bytes: 0, download_url: '' },
  },
  {
    id: 'sys2',
    type: VarInInspectType.system,
    name: 'user_id',
    description: '',
    selector: ['sys', 'user_id'],
    value_type: VarType.string,
    value: 'djflakjerlkjdlksfjslakjsdfl',
    edited: false,
    visible: true,
    is_truncated: false,
    full_content: { size_bytes: 0, download_url: '' },
  },
]
