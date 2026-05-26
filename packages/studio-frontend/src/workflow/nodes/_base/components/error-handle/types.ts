import type { VarType } from '../../../../types'

export enum ErrorHandleTypeEnum {
  none = 'none',
  failBranch = 'fail-branch',
  defaultValue = 'default-value',
}

export type DefaultValueForm = {
  key: string
  type: VarType
  value?: any
}
