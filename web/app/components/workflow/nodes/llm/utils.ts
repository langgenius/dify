import type { ValidationError } from 'jsonschema'
import type { ArrayItems, Field } from './types'
import * as z from 'zod'
import { draft07Validator, forbidBooleanProperties } from '@/utils/validators'
import { extractPluginId } from '../../utils/plugin'
import { ArrayType, Type } from './types'

export enum LLMModelIssueCode {
  providerRequired = 'provider-required',
  providerPluginUnavailable = 'provider-plugin-unavailable',
}

export const getLLMModelIssue = ({
  modelProvider,
  isModelProviderInstalled = true,
}: {
  modelProvider?: string
  isModelProviderInstalled?: boolean
}) => {
  if (!modelProvider)
    return LLMModelIssueCode.providerRequired

  if (!isModelProviderInstalled)
    return LLMModelIssueCode.providerPluginUnavailable

  return null
}

export const isLLMModelProviderInstalled = (modelProvider: string | undefined, installedPluginIds: ReadonlySet<string>) => {
  if (!modelProvider)
    return true

  return installedPluginIds.has(extractPluginId(modelProvider))
}

export const getFieldType = (field: Field) => {
  const { type, items, enum: enums } = field
  if (field.schemaType === 'file')
    return Type.file
  if (enums && enums.length > 0)
    return Type.enumType
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

const getTypeOf = (target: any) => {
  if (target === null)
    return 'null'
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

const inferType = (value: any): Type => {
  const type = getTypeOf(value)
  if (type === 'array')
    return Type.array
  // type boolean will be treated as string
  if (type === 'boolean')
    return Type.string
  if (type === 'number')
    return Type.number
  if (type === 'string')
    return Type.string
  if (type === 'object')
    return Type.object
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
