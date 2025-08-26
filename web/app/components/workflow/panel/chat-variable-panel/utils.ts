import type { ObjectValueItem } from './type'
import { ChatVarType } from './type'
import {
  TYPE_ARRAY_STRING_DEFAULT_VALUE,
  TYPE_OBJECT_DEFAULT_VALUE,
} from './constants'

const formatValueFromObject = (list: ObjectValueItem[]) => {
  return list.reduce((acc: any, curr) => {
    if (curr.key)
      acc[curr.key] = curr.value || null
    return acc
  }, {})
}
export const getObjectValue = (fromJson: boolean, value?: any) => {
  if (fromJson) {
    if (!value)
      return TYPE_OBJECT_DEFAULT_VALUE
    try {
      const result = JSON.parse(value)
      const newValue = Object.keys(result).map((key) => {
        return {
          key,
          type: typeof result[key] === 'string' ? ChatVarType.String : ChatVarType.Number,
          value: result[key],
        }
      })
      return newValue
    }
    catch {
      return TYPE_OBJECT_DEFAULT_VALUE
    }
  }
  else {
    if (!value)
      return undefined
    return JSON.stringify(formatValueFromObject(value))
  }
}

export const getArrayValue = (fromJson: boolean, value?: any) => {
  if (fromJson) {
    if (!value)
      return TYPE_ARRAY_STRING_DEFAULT_VALUE

    return JSON.parse(value)
  }
  else {
    if (!value)
      return undefined

    return JSON.stringify((value?.length && value.filter(Boolean).length) ? value.filter(Boolean) : undefined)
  }
}

export const getValue = (type: ChatVarType, fromJson: boolean, value?: any) => {
  switch (type) {
    case ChatVarType.Object:
      return getObjectValue(fromJson, value)
    case ChatVarType.ArrayNumber:
    case ChatVarType.ArrayString:
      return getArrayValue(fromJson, value)
    default:
      return value
  }
}
