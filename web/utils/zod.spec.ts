import { z, ZodError } from 'zod'

describe('Zod Features', () => {
  it('should support string', () => {
    const stringSchema = z.string()
    const numberLikeStringSchema = z.coerce.string() // 12 would be converted to '12'
    const stringSchemaWithError = z.string({
      required_error: 'Name is required',
      invalid_type_error: 'Invalid name type, expected string',
    })

    const urlSchema = z.string().url()
    const uuidSchema = z.string().uuid()

    expect(stringSchema.parse('hello')).toBe('hello')
    expect(() => stringSchema.parse(12)).toThrow()
    expect(numberLikeStringSchema.parse('12')).toBe('12')
    expect(numberLikeStringSchema.parse(12)).toBe('12')
    expect(() => stringSchemaWithError.parse(undefined)).toThrow('Name is required')
    expect(() => stringSchemaWithError.parse(12)).toThrow('Invalid name type, expected string')

    expect(urlSchema.parse('https://dify.ai')).toBe('https://dify.ai')
    expect(uuidSchema.parse('123e4567-e89b-12d3-a456-426614174000')).toBe('123e4567-e89b-12d3-a456-426614174000')
  })

  it('should support enum', () => {
    enum JobStatus {
      waiting = 'waiting',
      processing = 'processing',
      completed = 'completed',
    }
    expect(z.nativeEnum(JobStatus).parse(JobStatus.waiting)).toBe(JobStatus.waiting)
    expect(z.nativeEnum(JobStatus).parse('completed')).toBe('completed')
    expect(() => z.nativeEnum(JobStatus).parse('invalid')).toThrow()
  })

  it('should support number', () => {
    const numberSchema = z.number()
    const numberWithMin = z.number().gt(0) // alias min
    const numberWithMinEqual = z.number().gte(0)
    const numberWithMax = z.number().lt(100) // alias max

    expect(numberSchema.parse(123)).toBe(123)
    expect(numberWithMin.parse(50)).toBe(50)
    expect(numberWithMinEqual.parse(0)).toBe(0)
    expect(() => numberWithMin.parse(-1)).toThrow()
    expect(numberWithMax.parse(50)).toBe(50)
    expect(() => numberWithMax.parse(101)).toThrow()
  })

  it('should support boolean', () => {
    const booleanSchema = z.boolean()
    expect(booleanSchema.parse(true)).toBe(true)
    expect(booleanSchema.parse(false)).toBe(false)
    expect(() => booleanSchema.parse('true')).toThrow()
  })

  it('should support date', () => {
    const dateSchema = z.date()
    expect(dateSchema.parse(new Date('2023-01-01'))).toEqual(new Date('2023-01-01'))
  })

  it('should support object', () => {
    const userSchema = z.object({
      id: z.union([z.string(), z.number()]),
      name: z.string(),
      email: z.string().email(),
      age: z.number().min(0).max(120).optional(),
    })

    type User = z.infer<typeof userSchema>

    const validUser: User = {
      id: 1,
      name: 'John',
      email: 'john@example.com',
      age: 30,
    }

    expect(userSchema.parse(validUser)).toEqual(validUser)
  })

  it('should support object optional field', () => {
    const userSchema = z.object({
      name: z.string(),
      optionalField: z.optional(z.string()),
    })
    type User = z.infer<typeof userSchema>

    const user: User = {
      name: 'John',
    }
    const userWithOptionalField: User = {
      name: 'John',
      optionalField: 'optional',
    }
    expect(userSchema.safeParse(user).success).toEqual(true)
    expect(userSchema.safeParse(userWithOptionalField).success).toEqual(true)
  })

  it('should support object intersection', () => {
    const Person = z.object({
      name: z.string(),
    })

    const Employee = z.object({
      role: z.string(),
    })

    const EmployedPerson = z.intersection(Person, Employee)
    const validEmployedPerson = {
      name: 'John',
      role: 'Developer',
    }
    expect(EmployedPerson.parse(validEmployedPerson)).toEqual(validEmployedPerson)
  })

  it('should support record', () => {
    const recordSchema = z.record(z.string(), z.number())
    const validRecord = {
      a: 1,
      b: 2,
    }
    expect(recordSchema.parse(validRecord)).toEqual(validRecord)
  })

  it('should support array', () => {
    const numbersSchema = z.array(z.number())
    const stringArraySchema = z.string().array()

    expect(numbersSchema.parse([1, 2, 3])).toEqual([1, 2, 3])
    expect(stringArraySchema.parse(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('should support promise', async () => {
    const promiseSchema = z.promise(z.string())
    const validPromise = Promise.resolve('success')

    await expect(promiseSchema.parse(validPromise)).resolves.toBe('success')
  })

  it('should support unions', () => {
    const unionSchema = z.union([z.string(), z.number()])

    expect(unionSchema.parse('success')).toBe('success')
    expect(unionSchema.parse(404)).toBe(404)
  })

  it('should support functions', () => {
    const functionSchema = z.function().args(z.string(), z.number(), z.optional(z.string())).returns(z.number())
    const validFunction = (name: string, age: number, _optional?: string): number => {
      return age
    }
    expect(functionSchema.safeParse(validFunction).success).toEqual(true)
  })

  it('should support undefined, null, any, and void', () => {
    const undefinedSchema = z.undefined()
    const nullSchema = z.null()
    const anySchema = z.any()

    expect(undefinedSchema.parse(undefined)).toBeUndefined()
    expect(nullSchema.parse(null)).toBeNull()
    expect(anySchema.parse('anything')).toBe('anything')
    expect(anySchema.parse(3)).toBe(3)
  })

  it('should safeParse would not throw', () => {
    expect(z.string().safeParse('abc').success).toBe(true)
    expect(z.string().safeParse(123).success).toBe(false)
    expect(z.string().safeParse(123).error).toBeInstanceOf(ZodError)
  })
})
