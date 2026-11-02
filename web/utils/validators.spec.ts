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
