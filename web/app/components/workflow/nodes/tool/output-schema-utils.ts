import type { SchemaTypeDefinition } from '@/service/use-common'
import { VarType } from '@/app/components/workflow/types'
import { getMatchedSchemaType } from '../_base/components/variable/use-match-schema-type'

/**
 * Workflow-as-tool and some internal APIs store Dify VarType strings (e.g. `array[string]`)
 * in JSON Schema `type` instead of standard `{ type: 'array', items: { type: 'string' } }`.
 * Map those compact strings to VarType so downstream (e.g. Code node var picker) does not
 * fall back to `any` and get filtered out.
 */
const resolveDifyCompactTypeString = (typeStr: string): VarType | undefined => {
  const trimmed = typeStr.trim()
  const m = /^array\[(string|number|integer|boolean|object|file|any)\]$/i.exec(trimmed)
  if (!m)
    return undefined
  const inner = m[1]!.toLowerCase()
  const map: Record<string, VarType> = {
    string: VarType.arrayString,
    number: VarType.arrayNumber,
    integer: VarType.arrayNumber,
    boolean: VarType.arrayBoolean,
    object: VarType.arrayObject,
    file: VarType.arrayFile,
    any: VarType.arrayAny,
  }
  return map[inner]
}

/**
 * Normalizes a JSON Schema type to a simple string type.
 * Handles complex schemas with oneOf, anyOf, allOf.
 */
export const normalizeJsonSchemaType = (schema: any): string | undefined => {
  if (!schema)
    return undefined
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

/**
 * Extracts the items schema from an array schema.
 */
export const pickItemSchema = (schema: any) => {
  if (!schema || !schema.items)
    return undefined
  return Array.isArray(schema.items) ? schema.items[0] : schema.items
}

/**
 * Resolves a JSON Schema to a VarType enum value.
 * Properly handles array types by inspecting item types.
 */
export const resolveVarType = (
  schema: any,
  schemaTypeDefinitions?: SchemaTypeDefinition[],
): { type: VarType, schemaType?: string } => {
  const schemaType = getMatchedSchemaType(schema, schemaTypeDefinitions)
  if (schema && typeof schema.type === 'string') {
    const compact = resolveDifyCompactTypeString(schema.type)
    if (compact !== undefined)
      return { type: compact, schemaType }
  }

  const normalizedType = normalizeJsonSchemaType(schema)

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
      if (schemaType === 'file')
        return { type: VarType.file, schemaType }
      return { type: VarType.object, schemaType }
    case 'array': {
      const itemSchema = pickItemSchema(schema)
      if (!itemSchema)
        return { type: VarType.array, schemaType }

      const { type: itemType, schemaType: itemSchemaType } = resolveVarType(itemSchema, schemaTypeDefinitions)
      const resolvedSchemaType = schemaType || itemSchemaType

      if (itemSchemaType === 'file')
        return { type: VarType.arrayFile, schemaType: resolvedSchemaType }

      switch (itemType) {
        case VarType.string:
          return { type: VarType.arrayString, schemaType: resolvedSchemaType }
        case VarType.number:
        case VarType.integer:
          return { type: VarType.arrayNumber, schemaType: resolvedSchemaType }
        case VarType.boolean:
          return { type: VarType.arrayBoolean, schemaType: resolvedSchemaType }
        case VarType.object:
          return { type: VarType.arrayObject, schemaType: resolvedSchemaType }
        case VarType.file:
          return { type: VarType.arrayFile, schemaType: resolvedSchemaType }
        default:
          return { type: VarType.array, schemaType: resolvedSchemaType }
      }
    }
    default:
      return { type: VarType.any, schemaType }
  }
}
