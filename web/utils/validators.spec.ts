import { draft07Validator, forbidBooleanProperties } from './validators'

describe('Validators', () => {
  describe('draft07Validator', () => {
    it('should validate a valid JSON schema', () => {
      const validSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          addresses: {
            type: 'array',
            items: { type: 'object', properties: { city: { type: 'string' } } },
          },
        },
      }
      const result = draft07Validator(validSchema)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should invalidate schema with unknown type', () => {
      const invalidSchema = {
        type: 'invalid_type',
      }
      const result = draft07Validator(invalidSchema)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  describe('forbidBooleanProperties', () => {
    it.each([true, false])('finds a boolean property schema inside array items: %s', (flag) => {
      const schema = {
        type: 'object',
        properties: {
          rows: {
            type: 'array',
            items: { type: 'object', properties: { flag } },
          },
        },
      }

      expect(draft07Validator(schema).valid).toBe(true)
      expect(forbidBooleanProperties(schema)).toEqual([
        "Error: Property 'rows.items.flag' must not be a boolean schema",
      ])
    })

    it.each(['allOf', 'anyOf', 'oneOf'])(
      'checks property schemas inside %s branches',
      (keyword) => {
        const schema = {
          type: 'object',
          [keyword]: [{ type: 'object', properties: { flag: false } }],
        }
        expect(forbidBooleanProperties(schema)).toEqual([
          `Error: Property '${keyword}.0.flag' must not be a boolean schema`,
        ])
      },
    )

    it.each(['definitions', '$defs', 'dependencies', 'patternProperties'])(
      'checks property schemas inside %s entries',
      (keyword) => {
        const schema = { [keyword]: { row: { type: 'object', properties: { flag: true } } } }
        expect(forbidBooleanProperties(schema)).toEqual([
          `Error: Property '${keyword}.row.flag' must not be a boolean schema`,
        ])
      },
    )

    it('checks tuple item schemas and object-valued additionalProperties', () => {
      const schema = {
        properties: {
          rows: { type: 'array', items: [{ properties: { flag: false } }] },
        },
        additionalProperties: { properties: { other: true } },
      }
      expect(forbidBooleanProperties(schema)).toEqual([
        "Error: Property 'rows.items.0.flag' must not be a boolean schema",
        "Error: Property 'additionalProperties.other' must not be a boolean schema",
      ])
    })

    it('keeps boolean field types, schema flags, and literal data valid', () => {
      const literal = { properties: { flag: true } }
      const schema = {
        type: 'object',
        properties: {
          flag: { type: 'boolean', default: false },
          rows: { type: 'array', items: true, additionalItems: false },
          data: {
            type: 'object',
            default: literal,
            const: literal,
            examples: [literal],
            enum: [literal],
          },
        },
        additionalProperties: false,
        allOf: [true],
        anyOf: [true],
        oneOf: [true],
        not: false,
        if: true,
        then: true,
        else: false,
        definitions: { anything: true },
        dependencies: { data: ['flag'] },
      }

      expect(draft07Validator(schema).valid).toBe(true)
      expect(forbidBooleanProperties(schema)).toEqual([])
    })

    it('should return empty array for schema without boolean properties', () => {
      const schema = {
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      }
      const errors = forbidBooleanProperties(schema)
      expect(errors).toHaveLength(0)
    })

    it('should detect boolean property at root level', () => {
      const schema = {
        properties: {
          name: true,
          age: { type: 'number' },
        },
      }
      const errors = forbidBooleanProperties(schema)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('name')
    })

    it('should detect boolean properties in nested objects', () => {
      const schema = {
        properties: {
          user: {
            properties: {
              name: true,
              profile: {
                properties: {
                  bio: false,
                },
              },
            },
          },
        },
      }
      const errors = forbidBooleanProperties(schema)
      expect(errors).toHaveLength(2)
      expect(errors.some((e) => e.includes('user.name'))).toBe(true)
      expect(errors.some((e) => e.includes('user.profile.bio'))).toBe(true)
    })

    it('should handle schema without properties', () => {
      const schema = { type: 'string' }
      const errors = forbidBooleanProperties(schema)
      expect(errors).toHaveLength(0)
    })

    it('should handle null schema', () => {
      const errors = forbidBooleanProperties(null)
      expect(errors).toHaveLength(0)
    })

    it('should handle empty schema', () => {
      const errors = forbidBooleanProperties({})
      expect(errors).toHaveLength(0)
    })
  })
})
