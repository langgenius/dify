import type { ZodSchema } from 'zod'

type SubmitValidator<T> = ({ value }: { value: T }) => { fields: Record<string, string> } | undefined

export const zodSubmitValidator = <T>(schema: ZodSchema<T>): SubmitValidator<T> => {
  return ({ value }) => {
    const result = schema.safeParse(value)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of result.error.issues) {
        const path = issue.path[0]
        if (path === undefined)
          continue
        const key = String(path)
        if (!fieldErrors[key])
          fieldErrors[key] = issue.message
      }
      return { fields: fieldErrors }
    }
    return undefined
  }
}
