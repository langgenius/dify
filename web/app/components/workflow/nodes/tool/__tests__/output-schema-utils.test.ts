import { VarType } from '@/app/components/workflow/types'
import {
  normalizeJsonSchemaType,
  pickItemSchema,
  resolveVarType,
} from '../output-schema-utils'

// Mock the getMatchedSchemaType dependency
vi.mock('../../_base/components/variable/use-match-schema-type', () => ({
  getMatchedSchemaType: (schema: any) => {
    // Return schema_type or schemaType if present
    return schema?.schema_type || schema?.schemaType || undefined
  },
}))

describe('output-schema-utils', () => {
  describe('normalizeJsonSchemaType', () => {
    it('should return undefined for null or undefined schema', () => {
      expect(normalizeJsonSchemaType(null)).toBeUndefined()
      expect(normalizeJsonSchemaType(undefined)).toBeUndefined()
    })

    it('should return the type directly for simple string type', () => {
      expect(normalizeJsonSchemaType({ type: 'string' })).toBe('string')
      expect(normalizeJsonSchemaType({ type: 'number' })).toBe('number')
      expect(normalizeJsonSchemaType({ type: 'boolean' })).toBe('boolean')
      expect(normalizeJsonSchemaType({ type: 'object' })).toBe('object')
      expect(normalizeJsonSchemaType({ type: 'array' })).toBe('array')
      expect(normalizeJsonSchemaType({ type: 'integer' })).toBe('integer')
    })

    it('should handle array type with nullable (e.g., ["string", "null"])', () => {
      expect(normalizeJsonSchemaType({ type: ['string', 'null'] })).toBe('string')
      expect(normalizeJsonSchemaType({ type: ['null', 'number'] })).toBe('number')
      expect(normalizeJsonSchemaType({ type: ['object', 'null'] })).toBe('object')
    })

    it('should handle oneOf schema', () => {
      expect(normalizeJsonSchemaType({
        oneOf: [
          { type: 'string' },
          { type: 'null' },
        ],
      })).toBe('string')
    })

    it('should handle anyOf schema', () => {
      expect(normalizeJsonSchemaType({
        anyOf: [
          { type: 'number' },
          { type: 'null' },
        ],
      })).toBe('number')
    })

    it('should handle allOf schema', () => {
      expect(normalizeJsonSchemaType({
        allOf: [
          { type: 'object' },
        ],
      })).toBe('object')
    })

    it('should infer object type from properties', () => {
      expect(normalizeJsonSchemaType({
        properties: {
          name: { type: 'string' },
        },
      })).toBe('object')
    })

    it('should infer array type from items', () => {
      expect(normalizeJsonSchemaType({
        items: { type: 'string' },
      })).toBe('array')
    })

    it('should return undefined for empty schema', () => {
      expect(normalizeJsonSchemaType({})).toBeUndefined()
    })
  })

  describe('pickItemSchema', () => {
    it('should return undefined for null or undefined schema', () => {
      expect(pickItemSchema(null)).toBeUndefined()
      expect(pickItemSchema(undefined)).toBeUndefined()
    })

    it('should return undefined if no items property', () => {
      expect(pickItemSchema({ type: 'array' })).toBeUndefined()
      expect(pickItemSchema({})).toBeUndefined()
    })

    it('should return items directly if items is an object', () => {
      const itemSchema = { type: 'string' }
      expect(pickItemSchema({ items: itemSchema })).toBe(itemSchema)
    })

    it('should return first item if items is an array (tuple schema)', () => {
      const firstItem = { type: 'string' }
      const secondItem = { type: 'number' }
      expect(pickItemSchema({ items: [firstItem, secondItem] })).toBe(firstItem)
    })
  })

  describe('resolveVarType', () => {
    describe('primitive types', () => {
      it('should resolve string type', () => {
        const result = resolveVarType({ type: 'string' })
        expect(result.type).toBe(VarType.string)
      })

      it('should resolve number type', () => {
        const result = resolveVarType({ type: 'number' })
        expect(result.type).toBe(VarType.number)
      })

      it('should resolve integer type', () => {
        const result = resolveVarType({ type: 'integer' })
        expect(result.type).toBe(VarType.integer)
      })

      it('should resolve boolean type', () => {
        const result = resolveVarType({ type: 'boolean' })
        expect(result.type).toBe(VarType.boolean)
      })

      it('should resolve object type', () => {
        const result = resolveVarType({ type: 'object' })
        expect(result.type).toBe(VarType.object)
      })
    })

    describe('array types', () => {
      it('should resolve array of strings to arrayString', () => {
        const result = resolveVarType({
          type: 'array',
          items: { type: 'string' },
        })
        expect(result.type).toBe(VarType.arrayString)
      })

      it('should resolve array of numbers to arrayNumber', () => {
        const result = resolveVarType({
          type: 'array',
          items: { type: 'number' },
        })
        expect(result.type).toBe(VarType.arrayNumber)
      })

      it('should resolve array of integers to arrayNumber', () => {
        const result = resolveVarType({
          type: 'array',
          items: { type: 'integer' },
        })
        expect(result.type).toBe(VarType.arrayNumber)
      })

      it('should resolve array of booleans to arrayBoolean', () => {
        const result = resolveVarType({
          type: 'array',
          items: { type: 'boolean' },
        })
        expect(result.type).toBe(VarType.arrayBoolean)
      })

      it('should resolve array of objects to arrayObject', () => {
        const result = resolveVarType({
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
            },
          },
        })
        expect(result.type).toBe(VarType.arrayObject)
      })

      it('should resolve array without items to generic array', () => {
        const result = resolveVarType({ type: 'array' })
        expect(result.type).toBe(VarType.array)
      })
    })

    describe('complex schema - user scenario (tags field)', () => {
      it('should correctly resolve tags array with object items', () => {
        // This is the exact schema from the user's issue
        const tagsSchema = {
          type: 'array',
          description: '标签数组',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: '标签ID',
              },
              k: {
                type: 'number',
                description: '标签类型',
              },
              group: {
                type: 'number',
                description: '标签分组',
              },
            },
          },
        }

        const result = resolveVarType(tagsSchema)
        expect(result.type).toBe(VarType.arrayObject)
      })
    })

    describe('nullable types', () => {
      it('should handle nullable string type', () => {
        const result = resolveVarType({ type: ['string', 'null'] })
        expect(result.type).toBe(VarType.string)
      })

      it('should handle nullable array type', () => {
        const result = resolveVarType({
          type: ['array', 'null'],
          items: { type: 'string' },
        })
        expect(result.type).toBe(VarType.arrayString)
      })
    })

    describe('unknown types', () => {
      it('should resolve unknown type to any', () => {
        const result = resolveVarType({ type: 'unknown_type' })
        expect(result.type).toBe(VarType.any)
      })

      it('should resolve empty schema to any', () => {
        const result = resolveVarType({})
        expect(result.type).toBe(VarType.any)
      })
    })

    describe('file types via schemaType', () => {
      it('should resolve object with file schemaType to file', () => {
        const result = resolveVarType({
          type: 'object',
          schema_type: 'file',
        })
        expect(result.type).toBe(VarType.file)
        expect(result.schemaType).toBe('file')
      })

      it('should resolve array of files to arrayFile', () => {
        const result = resolveVarType({
          type: 'array',
          items: {
            type: 'object',
            schema_type: 'file',
          },
        })
        expect(result.type).toBe(VarType.arrayFile)
      })
    })

    describe('nested arrays', () => {
      it('should handle array of arrays as generic array', () => {
        const result = resolveVarType({
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'string' },
          },
        })
        // Nested arrays fall back to generic array type
        expect(result.type).toBe(VarType.array)
      })
    })
  })
})
