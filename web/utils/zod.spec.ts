import { z } from 'zod'

describe('Zod Features', () => {
  it('should support string related types', () => {
    const stringSchema = z.string()
    const numberLikeStringSchema = z.coerce.string() // 12 would be converted to '12'

    const urlSchema = z.string().url()
    const uuidSchema = z.string().uuid()

    expect(stringSchema.parse('hello')).toBe('hello')
    expect(() => stringSchema.parse(12)).toThrow()
    expect(numberLikeStringSchema.parse('12')).toBe('12')
    expect(numberLikeStringSchema.parse(12)).toBe('12')

    expect(urlSchema.parse('https://dify.ai')).toBe('https://dify.ai')
    expect(uuidSchema.parse('123e4567-e89b-12d3-a456-426614174000')).toBe('123e4567-e89b-12d3-a456-426614174000')
  })

  it('should support enum related types', () => {
    enum JobStatus {
      waiting = 'waiting',
      processing = 'processing',
      completed = 'completed',
    }
    expect(z.nativeEnum(JobStatus).parse(JobStatus.waiting)).toBe(JobStatus.waiting)
    expect(z.nativeEnum(JobStatus).parse('completed')).toBe('completed')
    expect(() => z.nativeEnum(JobStatus).parse('invalid')).toThrow()
  })

  it('should support number related types', () => {
    const numberSchema = z.number()
    const numberWithMin = z.number().gt(0)
    const numberWithMax = z.number().max(100)

    expect(numberSchema.parse(123)).toBe(123)
    expect(numberWithMin.parse(50)).toBe(50)
    expect(() => numberWithMin.parse(-1)).toThrow()
    expect(numberWithMax.parse(50)).toBe(50)
    expect(() => numberWithMax.parse(101)).toThrow()
  })

  it('should support boolean related types', () => {
    const booleanSchema = z.boolean()
    expect(booleanSchema.parse(true)).toBe(true)
  })

  it('should support date related types', () => {
    const dateSchema = z.date()
    expect(dateSchema.parse(new Date('2023-01-01'))).toEqual(new Date('2023-01-01'))
  })

  // it('should support undefined, null, any, and void types', () => {
  //   const undefinedSchema = z.undefined()
  //   const nullSchema = z.null()
  //   const anySchema = z.any()
  //   const voidSchema = z.void()

  //   expect(anySchema.parse('anything')).toBe('anything')
  //   expect(voidSchema.parse(undefined)).toBeUndefined()
  //   expect(voidSchema.parse(null)).toBeUndefined()
  //   expect(voidSchema.parse(123)).toBeUndefined()
  //   expect(voidSchema.parse('string')).toBeUndefined()
  //   expect(undefinedSchema.parse(undefined)).toBeUndefined()
  //   expect(nullSchema.parse(null)).toBeNull()
  // })

  it('should support object related types', () => {
    const userSchema = z.object({
      id: z.union([z.string(), z.number()]),
      name: z.string(),
      email: z.string().email(),
      age: z.number().min(0).max(120).optional(),
      optionalField: z.optional(z.string()),
    })

    type User = z.infer<typeof userSchema>

    const validUser: User = {
      id: 1,
      name: 'John',
      email: 'john@example.com',
      age: 30,
    }

    expect(userSchema.parse(validUser)).toEqual(validUser)

    const validUser2: User = {
      ...validUser,
      id: '1',
      optionalField: 'optional',
    }
    expect(userSchema.parse(validUser2)).toEqual(validUser2)
  })

  it('should support array related types', () => {
    const numbersSchema = z.array(z.number())
    const stringArraySchema = z.string().array()

    expect(numbersSchema.parse([1, 2, 3])).toEqual([1, 2, 3])
    expect(stringArraySchema.parse(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('should validate primitive types', () => {
    const stringSchema = z.string()
    const numberSchema = z.number()
    const booleanSchema = z.boolean()

    expect(stringSchema.parse('hello')).toBe('hello')
    expect(numberSchema.parse(123)).toBe(123)
    expect(booleanSchema.parse(true)).toBe(true)
  })

  it('should handle unions', () => {
    const resultSchema = z.union([z.string(), z.number()])

    expect(resultSchema.parse('success')).toBe('success')
    expect(resultSchema.parse(404)).toBe(404)
  })
})
