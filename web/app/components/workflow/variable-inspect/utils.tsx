import type { EnvironmentVariable } from '@/app/components/workflow/types'
import type { VarInInspect } from '@/types/workflow'
import { z } from 'zod'
import { VarType } from '@/app/components/workflow/types'
import { VarInInspectType } from '@/types/workflow'

const arrayStringSchemaParttern = z.array(z.string())
const arrayNumberSchemaParttern = z.array(z.number())

// # jsonSchema from https://zod.dev/?id=json-type
const literalSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
type Literal = z.infer<typeof literalSchema>
type Json = Literal | { [key: string]: Json } | Json[]
const jsonSchema: z.ZodType<Json> = z.lazy(() => z.union([literalSchema, z.array(jsonSchema), z.record(jsonSchema)]))
const arrayJsonSchema: z.ZodType<Json[]> = z.lazy(() => z.array(jsonSchema))

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

export const validateJSONSchema = (schema: unknown, type: string): z.SafeParseReturnType<unknown, unknown> => {
  if (type === 'array[string]') {
    const result = arrayStringSchemaParttern.safeParse(schema)
    return result
  }
  else if (type === 'array[number]') {
    const result = arrayNumberSchemaParttern.safeParse(schema)
    return result
  }
  else if (type === 'object') {
    const result = jsonSchema.safeParse(schema)
    return result
  }
  else if (type === 'array[object]' || type === 'array[message]') {
    const result = arrayJsonSchema.safeParse(schema)
    return result
  }
  else {
    return z.unknown().safeParse(schema)
  }
}

export const formatVarTypeLabel = (valueType?: string) => {
  if (valueType === 'array[message]')
    return 'List[promptMessage]'
  return valueType || ''
}
