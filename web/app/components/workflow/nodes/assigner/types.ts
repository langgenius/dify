import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'

export enum WriteMode {
  Overwrite = 'overwrite',
  Append = 'append',
  Clear = 'clear',
}

export type AssignerNodeType = CommonNodeType & {
  variable: ValueSelector
  writeMode: WriteMode
  value: any
  // valueType
}
