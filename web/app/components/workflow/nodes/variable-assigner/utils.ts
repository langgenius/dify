import type { Var } from '../../types'
import { VarType } from '../../types'

export const checkNodeValid = () => {
  return true
}

export const filterVar = (varType: VarType) => {
  return (v: Var) => {
    if (varType === VarType.any)
      return true
    if (v.type === VarType.any)
      return true
    return v.type === varType
  }
}
