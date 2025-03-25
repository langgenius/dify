import { ArrayType, Type } from './types'
import type { ArrayItems, Field, LLMNodeType } from './types'
import Ajv, { type ErrorObject } from 'ajv'
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

const draft7MetaSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'http://json-schema.org/draft-07/schema#',
  title: 'Core schema meta-schema',
  definitions: {
    schemaArray: {
      type: 'array',
      minItems: 1,
      items: {
        $ref: '#',
      },
    },
    nonNegativeInteger: {
      type: 'integer',
      minimum: 0,
    },
    nonNegativeIntegerDefault0: {
      allOf: [
        {
          $ref: '#/definitions/nonNegativeInteger',
        },
        {
          default: 0,
        },
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
      items: {
        type: 'string',
      },
      uniqueItems: true,
      default: [],
    },
  },
  type: [
    'object',
    'boolean',
  ],
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
    $comment: {
      type: 'string',
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
    writeOnly: {
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
    maxLength: {
      $ref: '#/definitions/nonNegativeInteger',
    },
    minLength: {
      $ref: '#/definitions/nonNegativeIntegerDefault0',
    },
    pattern: {
      type: 'string',
      format: 'regex',
    },
    additionalItems: {
      $ref: '#',
    },
    items: {
      anyOf: [
        {
          $ref: '#',
        },
        {
          $ref: '#/definitions/schemaArray',
        },
      ],
      default: true,
    },
    maxItems: {
      $ref: '#/definitions/nonNegativeInteger',
    },
    minItems: {
      $ref: '#/definitions/nonNegativeIntegerDefault0',
    },
    uniqueItems: {
      type: 'boolean',
      default: false,
    },
    contains: {
      $ref: '#',
    },
    maxProperties: {
      $ref: '#/definitions/nonNegativeInteger',
    },
    minProperties: {
      $ref: '#/definitions/nonNegativeIntegerDefault0',
    },
    required: {
      $ref: '#/definitions/stringArray',
    },
    additionalProperties: {
      $ref: '#',
    },
    definitions: {
      type: 'object',
      additionalProperties: {
        $ref: '#',
      },
      default: {

      },
    },
    properties: {
      type: 'object',
      additionalProperties: {
        $ref: '#',
      },
      default: {

      },
    },
    patternProperties: {
      type: 'object',
      additionalProperties: {
        $ref: '#',
      },
      propertyNames: {
        format: 'regex',
      },
      default: {

      },
    },
    dependencies: {
      type: 'object',
      additionalProperties: {
        anyOf: [
          {
            $ref: '#',
          },
          {
            $ref: '#/definitions/stringArray',
          },
        ],
      },
    },
    propertyNames: {
      $ref: '#',
    },
    const: true,
    enum: {
      type: 'array',
      items: true,
      minItems: 1,
      uniqueItems: true,
    },
    type: {
      anyOf: [
        {
          $ref: '#/definitions/simpleTypes',
        },
        {
          type: 'array',
          items: {
            $ref: '#/definitions/simpleTypes',
          },
          minItems: 1,
          uniqueItems: true,
        },
      ],
    },
    format: {
      type: 'string',
    },
    contentMediaType: {
      type: 'string',
    },
    contentEncoding: {
      type: 'string',
    },
    if: {
      $ref: '#',
    },
    then: {
      $ref: '#',
    },
    else: {
      $ref: '#',
    },
    allOf: {
      $ref: '#/definitions/schemaArray',
    },
    anyOf: {
      $ref: '#/definitions/schemaArray',
    },
    oneOf: {
      $ref: '#/definitions/schemaArray',
    },
    not: {
      $ref: '#',
    },
  },
  default: true,
}

const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  validateSchema: true,
  meta: false,
})
ajv.addMetaSchema(draft7MetaSchema)

export const validateSchemaAgainstDraft7 = (schemaToValidate: any) => {
  const schema = produce(schemaToValidate, (draft: any) => {
  // Make sure the schema has the $schema property for draft-07
    if (!draft.$schema)
      draft.$schema = 'http://json-schema.org/draft-07/schema#'
  })

  const valid = ajv.validateSchema(schema)

  return valid ? [] : ajv.errors || []
}

export const getValidationErrorMessage = (errors: ErrorObject[]) => {
  const message = errors.map((error) => {
    return `Error: ${error.instancePath} ${error.message} Details: ${JSON.stringify(error.params)}`
  }).join('; ')
  return message
}
