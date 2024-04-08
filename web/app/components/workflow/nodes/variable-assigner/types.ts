import type { CommonNodeType, ValueSelector, VarType } from '@/app/components/workflow/types'

export type VariableAssignerNodeType = CommonNodeType & {
  output_type: VarType
  variables: ValueSelector[]
}
