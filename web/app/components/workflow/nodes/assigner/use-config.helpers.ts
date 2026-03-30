import type { ValueSelector, Var } from '../../types'
import type { AssignerNodeOperation, AssignerNodeType } from './types'
import { produce } from 'immer'
import { VarType } from '../../types'
import { WriteMode } from './types'

export const filterVarByType = (varType: VarType) => {
  return (variable: Var) => {
    if (varType === VarType.any || variable.type === VarType.any)
      return true

    return variable.type === varType
  }
}

export const normalizeAssignedVarType = (assignedVarType: VarType, writeMode: WriteMode) => {
  if (
    writeMode === WriteMode.overwrite
    || writeMode === WriteMode.increment
    || writeMode === WriteMode.decrement
    || writeMode === WriteMode.multiply
    || writeMode === WriteMode.divide
    || writeMode === WriteMode.extend
  ) {
    return assignedVarType
  }

  if (writeMode === WriteMode.append) {
    switch (assignedVarType) {
      case VarType.arrayString:
        return VarType.string
      case VarType.arrayNumber:
        return VarType.number
      case VarType.arrayObject:
        return VarType.object
      default:
        return VarType.string
    }
  }

  return VarType.string
}

export const canAssignVar = (_varPayload: Var, selector: ValueSelector) => {
  return selector.join('.').startsWith('conversation')
}

export const canAssignToVar = (
  varPayload: Var,
  assignedVarType: VarType,
  writeMode: WriteMode,
) => {
  if (
    writeMode === WriteMode.overwrite
    || writeMode === WriteMode.extend
    || writeMode === WriteMode.increment
    || writeMode === WriteMode.decrement
    || writeMode === WriteMode.multiply
    || writeMode === WriteMode.divide
  ) {
    return varPayload.type === assignedVarType
  }

  if (writeMode === WriteMode.append) {
    switch (assignedVarType) {
      case VarType.arrayString:
        return varPayload.type === VarType.string
      case VarType.arrayNumber:
        return varPayload.type === VarType.number
      case VarType.arrayObject:
        return varPayload.type === VarType.object
      default:
        return false
    }
  }

  return true
}

export const ensureAssignerVersion = (newInputs: AssignerNodeType) => produce(newInputs, (draft) => {
  if (draft.version !== '2')
    draft.version = '2'
})

export const updateOperationItems = (
  inputs: AssignerNodeType,
  items: AssignerNodeOperation[],
) => produce(inputs, (draft) => {
  draft.items = [...items]
})
