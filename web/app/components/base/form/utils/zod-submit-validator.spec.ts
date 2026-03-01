import * as z from 'zod'
import { zodSubmitValidator } from './zod-submit-validator'

describe('zodSubmitValidator', () => {
  it('should return undefined for valid values', () => {
    const validator = zodSubmitValidator(z.object({
      name: z.string().min(2),
    }))

    expect(validator({ value: { name: 'Alice' } })).toBeUndefined()
  })

  it('should return first error message per field for invalid values', () => {
    const validator = zodSubmitValidator(z.object({
      name: z.string().min(3, 'Name too short'),
      age: z.number().min(18, 'Must be adult'),
    }))

    expect(validator({ value: { name: 'Al', age: 15 } })).toEqual({
      fields: {
        name: 'Name too short',
        age: 'Must be adult',
      },
    })
  })

  it('should ignore root-level issues without a field path', () => {
    const schema = z.object({ value: z.number() }).superRefine((_value, ctx) => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Root error',
        path: [],
      })
    })
    const validator = zodSubmitValidator(schema)

    expect(validator({ value: { value: 1 } })).toEqual({ fields: {} })
  })
})
