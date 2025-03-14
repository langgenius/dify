import { ArrayType, Type } from './types'
import type { Field, LLMNodeType } from './types'

export const checkNodeValid = (payload: LLMNodeType) => {
  return true
}

export const getFieldType = (field: Field) => {
  const { type, items } = field
  if (type !== Type.array || !items)
    return type

  return ArrayType[items.type]
}

export const getHasChildren = (schema: Field) => {
  const complexTypes = [Type.object, Type.array]
  if (!complexTypes.includes(schema.type))
    return false
  if (schema.type === Type.object)
    return schema.properties && Object.keys(schema.properties).length > 0
  if (schema.type === Type.array)
    return schema.items && schema.items.type === Type.object && schema.items.properties && Object.keys(schema.items.properties).length > 0
}
