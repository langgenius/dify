import * as z from 'zod'
import { zodSubmitValidator } from '../zod-submit-validator'

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

  it('should only keep the first error when multiple errors occur for the same field', () => {
    // Both string() empty check and email() validation will fail here conceptually,
    // but Zod aborts early on type errors sometimes. Let's use custom refinements that both trigger
    const schema = z.object({
      email: z.string().superRefine((val, ctx) => {
        if (!val.includes('@')) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid email format' })
        }
        if (val.length < 10) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Email too short' })
        }
      }),
    })
    const validator = zodSubmitValidator(schema)
    // "bad" triggers both missing '@' and length < 10
    expect(validator({ value: { email: 'bad' } })).toEqual({
      fields: {
        email: 'Invalid email format',
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
