import type { EnvironmentVariable } from '@/app/components/workflow/types'
import type { VarInInspect } from '@/types/workflow'
import * as z from 'zod'
import { VarType } from '@/app/components/workflow/types'
import { VarInInspectType } from '@/types/workflow'

const arrayStringSchemaParttern = z.array(z.string())
const arrayNumberSchemaParttern = z.array(z.number())

// # jsonSchema from https://zod.dev/?id=json-type
const literalSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
type Literal = z.infer<typeof literalSchema>
type Json = Literal | { [key: string]: Json } | Json[]
const jsonSchema: z.ZodType<Json> = z.lazy(() => z.union([literalSchema, z.array(jsonSchema), z.record(z.string(), jsonSchema)]))
const arrayJsonSchema: z.ZodType<Json[]> = z.lazy(() => z.array(jsonSchema))

type JsonSchemaType = 'array[string]' | 'array[number]' | 'object' | 'array[object]' | 'array[message]'

const isJsonSchemaType = (value: string): value is JsonSchemaType => {
  return value === 'array[string]'
    || value === 'array[number]'
    || value === 'object'
    || value === 'array[object]'
    || value === 'array[message]'
}

const validateKnownJSONSchema = (schema: unknown, type: JsonSchemaType) => {
  if (type === 'array[string]')
    return arrayStringSchemaParttern.safeParse(schema)
  if (type === 'array[number]')
    return arrayNumberSchemaParttern.safeParse(schema)
  if (type === 'object')
    return jsonSchema.safeParse(schema)
  return arrayJsonSchema.safeParse(schema)
}

const toEnvVarType = (valueType: EnvironmentVariable['value_type']): VarInInspect['value_type'] => {
  switch (valueType) {
    case 'number':
      return VarType.number
    case 'secret':
      return VarType.secret
    default:
      return VarType.string
  }
}

export const toEnvVarInInspect = (envVar: EnvironmentVariable): VarInInspect => {
  const valueType = envVar.value_type
  return {
    id: envVar.id,
    type: VarInInspectType.environment,
    name: envVar.name,
    description: envVar.description,
    selector: [VarInInspectType.environment, envVar.name],
    value_type: toEnvVarType(valueType),
    value: valueType === 'secret' ? '******************' : envVar.value,
    edited: false,
    visible: true,
    is_truncated: false,
    full_content: { size_bytes: 0, download_url: '' },
  }
}

export const validateJSONSchema = (schema: unknown, type: string) => {
  if (!isJsonSchemaType(type))
    return z.unknown().safeParse(schema)
  return validateKnownJSONSchema(schema, type)
}

export const formatVarTypeLabel = (valueType?: string) => {
  if (valueType === 'array[message]')
    return 'List[promptMessage]'
  return valueType || ''
}
