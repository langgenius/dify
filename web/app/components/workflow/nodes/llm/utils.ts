import { ArrayType, Type } from './types'
import type { ArrayItems, Field, LLMNodeType } from './types'

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

export const inferType = (value: any): Type => {
  if (Array.isArray(value)) return Type.array
  if (typeof value === 'boolean') return Type.boolean
  if (typeof value === 'number') return Type.number
  if (typeof value === 'string') return Type.string
  if (typeof value === 'object') return Type.object
  return Type.string
}

export function jsonToSchema(json: any): Field {
  const schema: Field = {
    type: inferType(json),
  }

  if (schema.type === 'object') {
    schema.properties = {}
    schema.required = []
    schema.additionalProperties = false

    Object.entries(json).forEach(([key, value]) => {
      schema.properties![key] = jsonToSchema(value)
      schema.required!.push(key)
    })
  }
  else if (schema.type === Type.array && json.length > 0) {
    schema.items = jsonToSchema(json[0]) as ArrayItems
  }

  return schema
}
