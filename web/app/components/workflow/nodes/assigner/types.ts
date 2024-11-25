import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

export enum WriteMode {
  Overwrite = 'over-write',
  Append = 'append',
  Clear = 'clear',
}

export enum ArrayOperation {
  overwrite = 'Overwrite',
  clear = 'Clear',
  append = 'Append',
  extend = 'Extend',
}

export enum ObjectAndStringOperation {
  overwrite = 'Overwrite',
  clear = 'Clear',
  const = 'Const',
}

export enum NumberOperation {
  overwrite = 'Overwrite',
  clear = 'Clear',
  const = 'Const',
  increment = '+=',
  decrement = '-=',
  multiply = '*=',
  divide = '/=',
}

export type AssignerNodeType = CommonNodeType & {
  assigned_variable_selector: ValueSelector
  write_mode: WriteMode
  input_variable_selector: ValueSelector
}
