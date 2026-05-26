import type { CommonNodeType, ValueSelector, VarType } from '../../types'

export type VarGroupItem = {
  output_type: VarType
  variables: ValueSelector[]
}
export type VariableAssignerNodeType = CommonNodeType & VarGroupItem & {
  advanced_settings: {
    group_enabled: boolean
    groups: ({
      group_name: string
      groupId: string
    } & VarGroupItem)[]
  }
}
