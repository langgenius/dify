import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

export const WriteMode = {
  overwrite: 'over-write',
  clear: 'clear',
  append: 'append',
  extend: 'extend',
  set: 'set',
  increment: '+=',
  decrement: '-=',
  multiply: '*=',
  divide: '/=',
  removeFirst: 'remove-first',
  removeLast: 'remove-last',
} as const

export type WriteMode = (typeof WriteMode)[keyof typeof WriteMode]

export const AssignerNodeInputType = {
  variable: 'variable',
  constant: 'constant',
} as const

export type AssignerNodeInputType =
  (typeof AssignerNodeInputType)[keyof typeof AssignerNodeInputType]

export type AssignerNodeOperation = {
  variable_selector: ValueSelector
  input_type: AssignerNodeInputType
  operation: WriteMode
  value: any
}

export type AssignerNodeType = CommonNodeType & {
  version?: '1' | '2'
  items: AssignerNodeOperation[]
}

export const writeModeTypesNum: WriteMode[] = [
  WriteMode.increment,
  WriteMode.decrement,
  WriteMode.multiply,
  WriteMode.divide,
]
