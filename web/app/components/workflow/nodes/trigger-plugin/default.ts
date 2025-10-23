import { INVALID_SUBSCRIPTION_ID } from '@/app/components/plugins/plugin-detail-panel/subscription-list/selector-entry'
import type { SchemaTypeDefinition } from '@/service/use-common'
import type { NodeDefault, Var } from '../../types'
import { BlockEnum, VarType } from '../../types'
import { genNodeMetaData } from '../../utils'
import { VarKindType } from '../_base/types'
import { type Field, type StructuredOutput, Type } from '../llm/types'
import type { PluginTriggerNodeType } from './types'

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

const extractSchemaType = (schema: any, _schemaTypeDefinitions?: SchemaTypeDefinition[]): string | undefined => {
  if (!schema)
    return undefined

  const schemaTypeFromSchema = schema.schema_type || schema.schemaType
  if (typeof schemaTypeFromSchema === 'string' && schemaTypeFromSchema.trim().length > 0)
    return schemaTypeFromSchema

  return undefined
}

const NORMALIZED_TYPE_TO_VAR_TYPE: Record<string, VarType> = {
  string: VarType.string,
  number: VarType.number,
  integer: VarType.integer,
  boolean: VarType.boolean,
  object: VarType.object,
  array: VarType.array,
}

const VAR_TYPE_TO_ARRAY_TYPE: Partial<Record<VarType, VarType>> = {
  [VarType.string]: VarType.arrayString,
  [VarType.number]: VarType.arrayNumber,
  [VarType.integer]: VarType.arrayNumber,
  [VarType.boolean]: VarType.arrayBoolean,
  [VarType.object]: VarType.arrayObject,
  [VarType.file]: VarType.arrayFile,
}

const NORMALIZED_TYPE_TO_FIELD_TYPE: Record<string, Type> = {
  string: Type.string,
  number: Type.number,
  integer: Type.number,
  boolean: Type.boolean,
  object: Type.object,
  array: Type.array,
}

const resolveVarType = (
  schema: any,
  schemaTypeDefinitions?: SchemaTypeDefinition[],
): { type: VarType; schemaType?: string } => {
  const schemaType = extractSchemaType(schema, schemaTypeDefinitions)
  const normalizedType = normalizeJsonSchemaType(schema)

  if (normalizedType === 'array') {
    const itemSchema = pickItemSchema(schema)
    if (!itemSchema)
      return { type: VarType.array, schemaType }

    const { type: itemType, schemaType: itemSchemaType } = resolveVarType(itemSchema, schemaTypeDefinitions)
    const resolvedSchemaType = schemaType || itemSchemaType

    const arrayType = VAR_TYPE_TO_ARRAY_TYPE[itemType] ?? VarType.array
    return { type: arrayType, schemaType: resolvedSchemaType }
  }

  const type = normalizedType ? NORMALIZED_TYPE_TO_VAR_TYPE[normalizedType] ?? VarType.any : VarType.any
  return { type, schemaType }
}

const toFieldType = (normalizedType: string | undefined, schemaType?: string): Type => {
  if (schemaType === 'file')
    return normalizedType === 'array' ? Type.array : Type.file

  return normalizedType ? NORMALIZED_TYPE_TO_FIELD_TYPE[normalizedType] ?? Type.string : Type.string
}

const toArrayItemType = (type: Type): Exclude<Type, Type.array> => {
  if (type === Type.array)
    return Type.object
  return type as Exclude<Type, Type.array>
}

const convertJsonSchemaToField = (schema: any, schemaTypeDefinitions?: SchemaTypeDefinition[]): Field => {
  const schemaType = extractSchemaType(schema, schemaTypeDefinitions)
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

const metaData = genNodeMetaData({
  sort: 1,
  type: BlockEnum.TriggerPlugin,
  helpLinkUri: 'plugin-trigger',
  isStart: true,
})

const nodeDefault: NodeDefault<PluginTriggerNodeType> = {
  metaData,
  defaultValue: {
    plugin_id: '',
    event_name: '',
    event_parameters: {},
    // event_type: '',
    config: {},
  },
  checkValid(payload: PluginTriggerNodeType, t: any, moreDataForCheckValid: {
    triggerInputsSchema?: Array<{
      variable: string
      label: string
      required?: boolean
    }>
    isReadyForCheckValid?: boolean
  } = {}) {
    let errorMessage = ''

    if (!payload.subscription_id || payload.subscription_id === INVALID_SUBSCRIPTION_ID)
      errorMessage = t('workflow.nodes.triggerPlugin.subscriptionRequired')

    const {
      triggerInputsSchema = [],
      isReadyForCheckValid = true,
    } = moreDataForCheckValid || {}

    if (!errorMessage && isReadyForCheckValid) {
      triggerInputsSchema.filter(field => field.required).forEach((field) => {
        if (errorMessage)
          return

        const rawParam = payload.event_parameters?.[field.variable]
          ?? (payload.config as Record<string, any> | undefined)?.[field.variable]
        if (!rawParam) {
          errorMessage = t('workflow.errorMsg.fieldRequired', { field: field.label })
          return
        }

        const targetParam = typeof rawParam === 'object' && rawParam !== null && 'type' in rawParam
          ? rawParam as { type: VarKindType; value: any }
          : { type: VarKindType.constant, value: rawParam }

        const { type, value } = targetParam
        if (type === VarKindType.variable) {
          if (!value || (Array.isArray(value) && value.length === 0))
            errorMessage = t('workflow.errorMsg.fieldRequired', { field: field.label })
        }
        else {
          if (value === undefined || value === null || value === '')
            errorMessage = t('workflow.errorMsg.fieldRequired', { field: field.label })
        }
      })
    }

    return {
      isValid: !errorMessage,
      errorMessage,
    }
  },
  getOutputVars(payload, _allPluginInfoList, _ragVars, { schemaTypeDefinitions } = { schemaTypeDefinitions: [] }) {
    const schema = payload.output_schema || {}

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
        ...(schemaType && { schemaType }),
      }

      if (normalizedType === 'object' && propertySchema?.properties) {
        const childProperties = Object.entries(propertySchema.properties).reduce((acc, [key, value]) => {
          acc[key] = convertJsonSchemaToField(value, schemaTypeDefinitions)
          return acc
        }, {} as Record<string, Field>)

        const required = Array.isArray(propertySchema?.required)
          ? propertySchema.required.filter(Boolean)
          : undefined

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
  },
}

export default nodeDefault
