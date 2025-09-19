import matchTheSchemaType from './match-schema-type'

describe('match the schema type', () => {
  it('should return true for identical primitive types', () => {
    expect(matchTheSchemaType({ type: 'string' }, { type: 'string' })).toBe(true)
    expect(matchTheSchemaType({ type: 'number' }, { type: 'number' })).toBe(true)
  })

  it('should return false for different primitive types', () => {
    expect(matchTheSchemaType({ type: 'string' }, { type: 'number' })).toBe(false)
  })

  it('should ignore values and only compare types', () => {
    expect(matchTheSchemaType({ type: 'string', value: 'hello' }, { type: 'string', value: 'world' })).toBe(true)
    expect(matchTheSchemaType({ type: 'number', value: 42 }, { type: 'number', value: 100 })).toBe(true)
  })

  it('should return true for structural differences but no types', () => {
    expect(matchTheSchemaType({ type: 'string', other: { b: 'xxx' } }, { type: 'string', other: 'xxx' })).toBe(true)
    expect(matchTheSchemaType({ type: 'string', other: { b: 'xxx' } }, { type: 'string' })).toBe(true)
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
    expect(matchTheSchemaType(obj1, obj2)).toBe(true)
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
    expect(matchTheSchemaType(obj1, obj2)).toBe(false)
  })

  it('file struct should match file type', () => {
    const fileSchema = {
      $id: 'https://dify.ai/schemas/v1/file.json',
      $schema: 'http://json-schema.org/draft-07/schema#',
      version: '1.0.0',
      type: 'object',
      title: 'File Schema',
      description: 'Schema for file objects (v1)',
      properties: {
        name: {
          type: 'string',
          description: 'file name',
        },
        size: {
          type: 'number',
          description: 'file size',
        },
        extension: {
          type: 'string',
          description: 'file extension',
        },
        type: {
          type: 'string',
          description: 'file type',
        },
        mime_type: {
          type: 'string',
          description: 'file mime type',
        },
        transfer_method: {
          type: 'string',
          description: 'file transfer method',
        },
        url: {
          type: 'string',
          description: 'file url',
        },
        related_id: {
          type: 'string',
          description: 'file related id',
        },
      },
      required: [
        'name',
      ],
    }
    const file = {
      type: 'object',
      title: 'File',
      description: 'Schema for file objects (v1)',
      properties: {
        name: {
          type: 'string',
          description: 'file name',
        },
        size: {
          type: 'number',
          description: 'file size',
        },
        extension: {
          type: 'string',
          description: 'file extension',
        },
        type: {
          type: 'string',
          description: 'file type',
        },
        mime_type: {
          type: 'string',
          description: 'file mime type',
        },
        transfer_method: {
          type: 'string',
          description: 'file transfer method',
        },
        url: {
          type: 'string',
          description: 'file url',
        },
        related_id: {
          type: 'string',
          description: 'file related id',
        },
      },
      required: [
        'name',
      ],
    }
    expect(matchTheSchemaType(fileSchema, file)).toBe(true)
  })
})
