import type { AssignerNodeType } from './types'
import { AssignerNodeInputType, WriteMode } from './types'

export const checkNodeValid = (_payload: AssignerNodeType) => {
  return true
}

export const formatOperationName = (type: string) => {
  if (type === 'over-write')
    return 'Overwrite'
  return type.charAt(0).toUpperCase() + type.slice(1)
}

type Item = {
  value: string | number
  name: string
}

export const getOperationItems = (
  assignedVarType?: string,
  writeModeTypes?: WriteMode[],
  writeModeTypesArr?: WriteMode[],
  writeModeTypesNum?: WriteMode[],
): Item[] => {
  if (assignedVarType?.startsWith('array') && writeModeTypesArr) {
    return writeModeTypesArr.map(type => ({
      value: type,
      name: type,
    }))
  }

  if (assignedVarType === 'number' && writeModeTypes && writeModeTypesNum) {
    return [
      ...writeModeTypes.map(type => ({
        value: type,
        name: type,
      })),
      { value: 'divider', name: 'divider' } as Item,
      ...writeModeTypesNum.map(type => ({
        value: type,
        name: type,
      })),
    ]
  }

  if (writeModeTypes && ['string', 'boolean', 'object'].includes(assignedVarType || '')) {
    return writeModeTypes.map(type => ({
      value: type,
      name: type,
    }))
  }

  return []
}

const convertOldWriteMode = (oldMode: string): WriteMode => {
  switch (oldMode) {
    case 'over-write':
      return WriteMode.overwrite
    case 'append':
      return WriteMode.append
    case 'clear':
      return WriteMode.clear
    default:
      return WriteMode.overwrite
  }
}

export const convertV1ToV2 = (payload: any): AssignerNodeType => {
  if (payload.version === '2' && payload.items)
    return payload as AssignerNodeType

  return {
    version: '2',
    items: [{
      variable_selector: payload.assigned_variable_selector || [],
      input_type: AssignerNodeInputType.variable,
      operation: convertOldWriteMode(payload.write_mode),
      value: payload.input_variable_selector || [],
    }],
    ...payload,
  }
}
