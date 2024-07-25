import type { CommonNodeType, ValueSelector, VarType } from '@/app/components/workflow/types'

export enum WriteMode {
  Overwrite = 'overwrite',
  Append = 'append',
  Clear = 'clear',
}

export type AssignerSupportVarType = VarType.string | VarType.number | VarType.object | VarType.arrayString | VarType.arrayNumber | VarType.arrayObject | VarType.arrayFile

export type AssignerNodeType = CommonNodeType & {
  variable: ValueSelector
  varType: VarType
  writeMode: WriteMode
  value: any
  // valueType
}
