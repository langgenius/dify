import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

export enum WriteMode {
  Overwrite = 'over-write',
  Append = 'append',
  Clear = 'clear',
}

export type AssignerNodeType = CommonNodeType & {
  assigned_variable_selector: ValueSelector
  write_mode: WriteMode
  input_variable_selector: ValueSelector
}
