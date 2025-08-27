import { deepEqualByType } from './use-match-schema-type'

describe('deepEqualByType', () => {
  it('should return true for identical primitive types', () => {
    expect(deepEqualByType({ type: 'string' }, { type: 'string' })).toBe(true)
    expect(deepEqualByType({ type: 'number' }, { type: 'number' })).toBe(true)
  })

  it('should return false for different primitive types', () => {
    expect(deepEqualByType({ type: 'string' }, { type: 'number' })).toBe(false)
  })

  it('should ignore values and only compare types', () => {
    expect(deepEqualByType({ type: 'string', value: 'hello' }, { type: 'string', value: 'world' })).toBe(true)
    expect(deepEqualByType({ type: 'number', value: 42 }, { type: 'number', value: 100 })).toBe(true)
  })

  it('should return true for structural differences but no types', () => {
    expect(deepEqualByType({ type: 'string', other: { b: 'xxx' } }, { type: 'string', other: 'xxx' })).toBe(true)
    expect(deepEqualByType({ type: 'string', other: { b: 'xxx' } }, { type: 'string' })).toBe(true)
  })

  it('should handle nested objects with same structure and types', () => {
    const obj1 = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
        address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' },
          },
        },
      },
    }
    const obj2 = {
      type: 'object',
      properties: {
        name: { type: 'string', value: 'Alice' },
        age: { type: 'number', value: 30 },
        address: {
          type: 'object',
          properties: {
            street: { type: 'string', value: '123 Main St' },
            city: { type: 'string', value: 'Wonderland' },
          },
        },
      },
    }
    expect(deepEqualByType(obj1, obj2)).toBe(true)
  })
  it('should return false for nested objects with different structures', () => {
    const obj1 = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    }
    const obj2 = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        address: { type: 'string' },
      },
    }
    expect(deepEqualByType(obj1, obj2)).toBe(false)
  })
})
