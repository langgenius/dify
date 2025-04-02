import { ArrayType, Type } from './types'
import type { ArrayItems, Field, LLMNodeType } from './types'
import type { Schema, ValidationError } from 'jsonschema'
import { Validator } from 'jsonschema'
import produce from 'immer'
import { z } from 'zod'

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

const draft07MetaSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'http://json-schema.org/draft-07/schema#',
  title: 'Core schema meta-schema',
  definitions: {
    schemaArray: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#' },
    },
    nonNegativeInteger: {
      type: 'integer',
      minimum: 0,
    },
    nonNegativeIntegerDefault0: {
      allOf: [
        { $ref: '#/definitions/nonNegativeInteger' },
        { default: 0 },
      ],
    },
    simpleTypes: {
      enum: [
        'array',
        'boolean',
        'integer',
        'null',
        'number',
        'object',
        'string',
      ],
    },
    stringArray: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      default: [],
    },
  },
  type: ['object', 'boolean'],
  properties: {
    $id: {
      type: 'string',
      format: 'uri-reference',
    },
    $schema: {
      type: 'string',
      format: 'uri',
    },
    $ref: {
      type: 'string',
      format: 'uri-reference',
    },
    title: {
      type: 'string',
    },
    description: {
      type: 'string',
    },
    default: true,
    readOnly: {
      type: 'boolean',
      default: false,
    },
    examples: {
      type: 'array',
      items: true,
    },
    multipleOf: {
      type: 'number',
      exclusiveMinimum: 0,
    },
    maximum: {
      type: 'number',
    },
    exclusiveMaximum: {
      type: 'number',
    },
    minimum: {
      type: 'number',
    },
    exclusiveMinimum: {
      type: 'number',
    },
    maxLength: { $ref: '#/definitions/nonNegativeInteger' },
    minLength: { $ref: '#/definitions/nonNegativeIntegerDefault0' },
    pattern: {
      type: 'string',
      format: 'regex',
    },
    additionalItems: { $ref: '#' },
    items: {
      anyOf: [
        { $ref: '#' },
        { $ref: '#/definitions/schemaArray' },
      ],
      default: true,
    },
    maxItems: { $ref: '#/definitions/nonNegativeInteger' },
    minItems: { $ref: '#/definitions/nonNegativeIntegerDefault0' },
    uniqueItems: {
      type: 'boolean',
      default: false,
    },
    contains: { $ref: '#' },
    maxProperties: { $ref: '#/definitions/nonNegativeInteger' },
    minProperties: { $ref: '#/definitions/nonNegativeIntegerDefault0' },
    required: { $ref: '#/definitions/stringArray' },
    additionalProperties: { $ref: '#' },
    definitions: {
      type: 'object',
      additionalProperties: { $ref: '#' },
      default: {},
    },
    properties: {
      type: 'object',
      additionalProperties: { $ref: '#' },
      default: {},
    },
    patternProperties: {
      type: 'object',
      additionalProperties: { $ref: '#' },
      propertyNames: { format: 'regex' },
      default: {},
    },
    dependencies: {
      type: 'object',
      additionalProperties: {
        anyOf: [
          { $ref: '#' },
          { $ref: '#/definitions/stringArray' },
        ],
      },
    },
    propertyNames: { $ref: '#' },
    const: true,
    enum: {
      type: 'array',
      items: true,
      minItems: 1,
      uniqueItems: true,
    },
    type: {
      anyOf: [
        { $ref: '#/definitions/simpleTypes' },
        {
          type: 'array',
          items: { $ref: '#/definitions/simpleTypes' },
          minItems: 1,
          uniqueItems: true,
        },
      ],
    },
    format: { type: 'string' },
    allOf: { $ref: '#/definitions/schemaArray' },
    anyOf: { $ref: '#/definitions/schemaArray' },
    oneOf: { $ref: '#/definitions/schemaArray' },
    not: { $ref: '#' },
  },
  default: true,
} as unknown as Schema

const validator = new Validator()

export const validateSchemaAgainstDraft7 = (schemaToValidate: any) => {
  const schema = produce(schemaToValidate, (draft: any) => {
  // Make sure the schema has the $schema property for draft-07
    if (!draft.$schema)
      draft.$schema = 'http://json-schema.org/draft-07/schema#'
  })

  const result = validator.validate(schema, draft07MetaSchema, {
    nestedErrors: true,
    throwError: false,
  })

  // Access errors from the validation result
  const errors = result.valid ? [] : result.errors || []

  return errors
}

export const getValidationErrorMessage = (errors: ValidationError[]) => {
  const message = errors.map((error) => {
    return `Error: ${error.path.join('.')} ${error.message} Details: ${JSON.stringify(error.stack)}`
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
