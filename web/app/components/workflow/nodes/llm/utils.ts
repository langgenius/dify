import { z } from 'zod'
import { ArrayType, Type } from './types'
import type { ArrayItems, Field, LLMNodeType } from './types'
import { draft07Validator, forbidBooleanProperties } from '@/utils/validators'
import type { ValidationError } from 'jsonschema'

export const checkNodeValid = (_payload: LLMNodeType) => {
  return true
}

export const getFieldType = (field: Field) => {
  const { type, items } = field
  if(field.schemaType === 'file') return Type.file
  if (type !== Type.array || !items)
    return type

  return ArrayType[items.type as keyof typeof ArrayType]
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

export const getTypeOf = (target: any) => {
  if (target === null) return 'null'
  if (typeof target !== 'object') {
    return typeof target
  }
  else {
    return Object.prototype.toString
      .call(target)
      .slice(8, -1)
      .toLocaleLowerCase()
  }
}

export const inferType = (value: any): Type => {
  const type = getTypeOf(value)
  if (type === 'array') return Type.array
  // type boolean will be treated as string
  if (type === 'boolean') return Type.string
  if (type === 'number') return Type.number
  if (type === 'string') return Type.string
  if (type === 'object') return Type.object
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
  else if (schema.type === Type.array) {
    schema.items = jsonToSchema(json[0]) as ArrayItems
  }

  return schema
}

export const checkJsonDepth = (json: any) => {
  if (!json || getTypeOf(json) !== 'object')
    return 0

  let maxDepth = 0

  if (getTypeOf(json) === 'array') {
    if (json[0] && getTypeOf(json[0]) === 'object')
      maxDepth = checkJsonDepth(json[0])
  }
  else if (getTypeOf(json) === 'object') {
    const propertyDepths = Object.values(json).map(value => checkJsonDepth(value))
    maxDepth = propertyDepths.length ? Math.max(...propertyDepths) + 1 : 1
  }

  return maxDepth
}

export const checkJsonSchemaDepth = (schema: Field) => {
  if (!schema || getTypeOf(schema) !== 'object')
    return 0

  let maxDepth = 0

  if (schema.type === Type.object && schema.properties) {
    const propertyDepths = Object.values(schema.properties).map(value => checkJsonSchemaDepth(value))
    maxDepth = propertyDepths.length ? Math.max(...propertyDepths) + 1 : 1
  }
  else if (schema.type === Type.array && schema.items && schema.items.type === Type.object) {
    maxDepth = checkJsonSchemaDepth(schema.items) + 1
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
  // First check against Draft-07
  const result = draft07Validator(schemaToValidate)
  // Then apply custom rule
  const customErrors = forbidBooleanProperties(schemaToValidate)

  return [...result.errors, ...customErrors]
}

export const getValidationErrorMessage = (errors: Array<ValidationError | string>) => {
  const message = errors.map((error) => {
    if (typeof error === 'string')
      return error
    else
      return `Error: ${error.stack}\n`
  }).join('')
  return message
}

// Previous Not support boolean type, so transform boolean to string when paste it into schema editor
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

const schemaRootObject = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.any()),
  required: z.array(z.string()),
  additionalProperties: z.boolean().optional(),
})

export const preValidateSchema = (schema: any) => {
  const result = schemaRootObject.safeParse(schema)
  return result
}
