import type { AssignerNodeType, WriteMode } from './types'

export const checkNodeValid = (payload: AssignerNodeType) => {
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

  if (writeModeTypes && ['string', 'object'].includes(assignedVarType || '')) {
    return writeModeTypes.map(type => ({
      value: type,
      name: type,
    }))
  }

  return []
}
