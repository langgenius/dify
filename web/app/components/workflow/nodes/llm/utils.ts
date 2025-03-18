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

export const jsonToSchema = (json: any): Field => {
  const schema: Field = {
    type: inferType(json),
  }

  if (schema.type === Type.object) {
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

export const checkDepth = (json: any, currentDepth = 1) => {
  const type = inferType(json)
  if (type !== Type.object && type !== Type.array)
    return currentDepth

  let maxDepth = currentDepth
  if (type === Type.object) {
    Object.keys(json).forEach((key) => {
      const depth = checkDepth(json[key], currentDepth + 1)
      maxDepth = Math.max(maxDepth, depth)
    })
  }
  else if (type === Type.array && json.length > 0) {
    const depth = checkDepth(json[0], currentDepth + 1)
    maxDepth = Math.max(maxDepth, depth)
  }
  return maxDepth
}

export const findPropertyWithPath = (target: any, path: string[]) => {
  let current = target
  for (const key of path)
    current = current[key]
  return current
}
