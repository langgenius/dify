import type { Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'

export const filterVar = (varType: VarType) => {
  return (v: Var) => {
    if (varType === VarType.any)
      return true
    if (v.type === VarType.any)
      return true
    return v.type === varType
  }
}
