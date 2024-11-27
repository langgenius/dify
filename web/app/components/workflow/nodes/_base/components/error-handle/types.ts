import type { VarType } from '@/app/components/workflow/types'

export enum ErrorHandleTypeEnum {
  none = 'none',
  failBranch = 'fail-branch',
  defaultValue = 'default-value',
}

export type DefaultValueForm = {
  variable: string
  type: VarType
}
