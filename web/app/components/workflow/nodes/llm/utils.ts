import { ArrayType, Type } from './types'
import type { ArrayItems, Field, LLMNodeType } from './types'
import type { ErrorObject } from 'ajv'
import { validateDraft07 } from '@/public/validate-esm.mjs'
import produce from 'immer'

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
  // type boolean will be treated as string
  if (typeof value === 'boolean') return Type.string
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

export const validateSchemaAgainstDraft7 = (schemaToValidate: any) => {
  const schema = produce(schemaToValidate, (draft: any) => {
  // Make sure the schema has the $schema property for draft-07
    if (!draft.$schema)
      draft.$schema = 'http://json-schema.org/draft-07/schema#'
  })

  const valid = validateDraft07(schema)

  // Access errors from the validation result
  const errors = valid ? [] : (validateDraft07 as any).errors || []

  return errors
}

export const getValidationErrorMessage = (errors: ErrorObject[]) => {
  const message = errors.map((error) => {
    return `Error: ${error.instancePath} ${error.message} Details: ${JSON.stringify(error.params)}`
  }).join('; ')
  return message
}

export const convertBooleanToString = (schema: any) => {
  if (schema.type === Type.boolean)
    schema.type = Type.string
  if (schema.type === Type.array && schema.items && schema.items.type === Type.boolean)
    schema.items.type = Type.string
  if (schema.type === Type.object) {
    schema.properties = Object.entries(schema.properties).reduce((acc, [key, value]) => {
      acc[key] = convertBooleanToString(value)
      return acc
    }, {} as any)
  }
  if (schema.type === Type.array && schema.items && schema.items.type === Type.object) {
    schema.items.properties = Object.entries(schema.items.properties).reduce((acc, [key, value]) => {
      acc[key] = convertBooleanToString(value)
      return acc
    }, {} as any)
  }
  return schema
}
