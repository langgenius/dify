import { z } from 'zod'

const arrayStringSchemaParttern = z.array(z.string())
const arrayNumberSchemaParttern = z.array(z.number())

// # jsonSchema from https://zod.dev/?id=json-type
const literalSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
type Literal = z.infer<typeof literalSchema>
type Json = Literal | { [key: string]: Json } | Json[]
const jsonSchema: z.ZodType<Json> = z.lazy(() => z.union([literalSchema, z.array(jsonSchema), z.record(jsonSchema)]))
const arrayJsonSchema: z.ZodType<Json[]> = z.lazy(() => z.array(jsonSchema))

export const validateJSONSchema = (schema: any, type: string) => {
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
  else if (type === 'array[object]') {
    const result = arrayJsonSchema.safeParse(schema)
    return result
  }
  else {
    return { success: true } as any
  }
}
