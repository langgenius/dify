import { BlockEnum, VarType } from '../../types'
import type { NodeDefault, Var } from '../../types'
import { genNodeMetaData } from '../../utils'
import type { PluginTriggerNodeType } from './types'
import { getMatchedSchemaType } from '../_base/components/variable/use-match-schema-type'
import type { SchemaTypeDefinition } from '@/service/use-common'
import { type Field, type StructuredOutput, Type } from '../llm/types'

const normalizeJsonSchemaType = (schema: any): string | undefined => {
  if (!schema) return undefined
  const { type, properties, items, oneOf, anyOf, allOf } = schema

  if (Array.isArray(type))
    return type.find((item: string | null) => item && item !== 'null') || type[0]

  if (typeof type === 'string')
    return type

  const compositeCandidates = [oneOf, anyOf, allOf]
    .filter((entry): entry is any[] => Array.isArray(entry))
    .flat()

  for (const candidate of compositeCandidates) {
    const normalized = normalizeJsonSchemaType(candidate)
    if (normalized)
      return normalized
  }

  if (properties)
    return 'object'

  if (items)
    return 'array'

  return undefined
}

const pickItemSchema = (schema: any) => {
  if (!schema || !schema.items)
    return undefined
  return Array.isArray(schema.items) ? schema.items[0] : schema.items
}

const resolveVarType = (schema: any, schemaTypeDefinitions?: SchemaTypeDefinition[]): { type: VarType; schemaType: string } => {
  const schemaType = getMatchedSchemaType(schema, schemaTypeDefinitions)
  const normalizedType = normalizeJsonSchemaType(schema)

  if (schemaType === 'file') {
    if (normalizedType === 'array')
      return { type: VarType.arrayFile, schemaType }
    return { type: VarType.file, schemaType }
  }

  switch (normalizedType) {
    case 'string':
      return { type: VarType.string, schemaType }
    case 'number':
      return { type: VarType.number, schemaType }
    case 'integer':
      return { type: VarType.integer, schemaType }
    case 'boolean':
      return { type: VarType.boolean, schemaType }
    case 'object':
      return { type: VarType.object, schemaType }
    case 'array': {
      const itemSchema = pickItemSchema(schema)
      if (!itemSchema)
        return { type: VarType.array, schemaType }

      const { type: itemType, schemaType: itemSchemaType } = resolveVarType(itemSchema, schemaTypeDefinitions)

      if (itemSchemaType === 'file')
        return { type: VarType.arrayFile, schemaType }

      switch (itemType) {
        case VarType.string:
          return { type: VarType.arrayString, schemaType }
        case VarType.number:
        case VarType.integer:
          return { type: VarType.arrayNumber, schemaType }
        case VarType.boolean:
          return { type: VarType.arrayBoolean, schemaType }
        case VarType.object:
          return { type: VarType.arrayObject, schemaType }
        case VarType.file:
          return { type: VarType.arrayFile, schemaType }
        default:
          return { type: VarType.array, schemaType }
      }
    }
    default:
      return { type: VarType.any, schemaType }
  }
}

const toFieldType = (normalizedType: string | undefined, schemaType?: string): Type => {
  if (schemaType === 'file')
    return normalizedType === 'array' ? Type.array : Type.file

  switch (normalizedType) {
    case 'number':
    case 'integer':
      return Type.number
    case 'boolean':
      return Type.boolean
    case 'object':
      return Type.object
    case 'array':
      return Type.array
    case 'string':
    default:
      return Type.string
  }
}

const toArrayItemType = (type: Type): Exclude<Type, Type.array> => {
  if (type === Type.array)
    return Type.object
  return type as Exclude<Type, Type.array>
}

const convertJsonSchemaToField = (schema: any, schemaTypeDefinitions?: SchemaTypeDefinition[]): Field => {
  const schemaType = getMatchedSchemaType(schema, schemaTypeDefinitions)
  const normalizedType = normalizeJsonSchemaType(schema)
  const fieldType = toFieldType(normalizedType, schemaType)

  const field: Field = {
    type: fieldType,
  }

  if (schema?.description)
    field.description = schema.description

  if (schemaType)
    field.schemaType = schemaType

  if (Array.isArray(schema?.enum))
    field.enum = schema.enum

  if (fieldType === Type.object) {
    const properties = schema?.properties || {}
    field.properties = Object.entries(properties).reduce((acc, [key, value]) => {
      acc[key] = convertJsonSchemaToField(value, schemaTypeDefinitions)
      return acc
    }, {} as Record<string, Field>)

    const required = Array.isArray(schema?.required) ? schema.required.filter(Boolean) : undefined
    field.required = required && required.length > 0 ? required : undefined
    field.additionalProperties = false
  }

  if (fieldType === Type.array) {
    const itemSchema = pickItemSchema(schema)
    if (itemSchema) {
      const itemField = convertJsonSchemaToField(itemSchema, schemaTypeDefinitions)
      const { type, ...rest } = itemField
      field.items = {
        ...rest,
        type: toArrayItemType(type),
      }
    }
  }

  return field
}

const buildOutputVars = (schema: Record<string, any>, schemaTypeDefinitions?: SchemaTypeDefinition[]): Var[] => {
  if (!schema || typeof schema !== 'object')
    return []

  const properties = schema.properties as Record<string, any> | undefined
  if (!properties)
    return []

  return Object.entries(properties).map(([name, propertySchema]) => {
    const { type, schemaType } = resolveVarType(propertySchema, schemaTypeDefinitions)
    const normalizedType = normalizeJsonSchemaType(propertySchema)

    const varItem: Var = {
      variable: name,
      type,
      des: propertySchema?.description,
      schemaType,
    }

    if (normalizedType === 'object') {
      const childProperties = propertySchema?.properties
        ? Object.entries(propertySchema.properties).reduce((acc, [key, value]) => {
          acc[key] = convertJsonSchemaToField(value, schemaTypeDefinitions)
          return acc
        }, {} as Record<string, Field>)
        : {}

      const required = Array.isArray(propertySchema?.required) ? propertySchema.required.filter(Boolean) : undefined

      varItem.children = {
        schema: {
          type: Type.object,
          properties: childProperties,
          required: required && required.length > 0 ? required : undefined,
          additionalProperties: false,
        },
      } as StructuredOutput
    }

    return varItem
  })
}

const metaData = genNodeMetaData({
  sort: 1,
  type: BlockEnum.TriggerPlugin,
  isStart: true,
})

const nodeDefault: NodeDefault<PluginTriggerNodeType> = {
  metaData,
  defaultValue: {
    plugin_id: '',
    event_name: '',
    // event_type: '',
    config: {},
  },
  checkValid(payload: PluginTriggerNodeType, t: any) {
    let errorMessage = ''

    if (!payload.subscription_id)
      errorMessage = t('workflow.nodes.triggerPlugin.subscriptionRequired')

    return {
      isValid: !errorMessage,
      errorMessage,
    }
  },
  getOutputVars(payload, _allPluginInfoList, _ragVars, { schemaTypeDefinitions } = { schemaTypeDefinitions: [] }) {
    const schema = payload.output_schema || {}
    return buildOutputVars(schema, schemaTypeDefinitions)
  },
}

export default nodeDefault
