import { z } from 'zod'

const arrayStringSchemaParttern = z.array(z.string())

export const validateArrayString = (schema: any) => {
  const result = arrayStringSchemaParttern.safeParse(schema)
  return result
}
