import { deepSanitizeFormValues, findMissingRequiredField, sanitizeFormValues } from '../form-helpers'

describe('Form Helpers', () => {
  describe('sanitizeFormValues', () => {
    it('should convert null values to empty strings', () => {
      const input = { field1: null, field2: 'value', field3: undefined }
      const result = sanitizeFormValues(input)

      expect(result).toEqual({
        field1: '',
        field2: 'value',
        field3: '',
      })
    })

    it('should convert undefined values to empty strings', () => {
      const input = { field1: undefined, field2: 'test' }
      const result = sanitizeFormValues(input)

      expect(result).toEqual({
        field1: '',
        field2: 'test',
      })
    })

    it('should convert non-string values to strings', () => {
      const input = { number: 123, boolean: true, string: 'test' }
      const result = sanitizeFormValues(input)

      expect(result).toEqual({
        number: '123',
        boolean: 'true',
        string: 'test',
      })
    })

    it('should handle empty objects', () => {
      const result = sanitizeFormValues({})
      expect(result).toEqual({})
    })

    it('should handle objects with mixed value types', () => {
      const input = {
        null_field: null,
        undefined_field: undefined,
        zero: 0,
        false_field: false,
        empty_string: '',
        valid_string: 'test',
      }
      const result = sanitizeFormValues(input)

      expect(result).toEqual({
        null_field: '',
        undefined_field: '',
        zero: '0',
        false_field: 'false',
        empty_string: '',
        valid_string: 'test',
      })
    })
  })

  describe('deepSanitizeFormValues', () => {
    it('should handle nested objects', () => {
      const input = {
        level1: {
          field1: null,
          field2: 'value',
          level2: {
            field3: undefined,
            field4: 'nested',
          },
        },
        simple: 'test',
      }
      const result = deepSanitizeFormValues(input)

      expect(result).toEqual({
        level1: {
          field1: '',
          field2: 'value',
          level2: {
            field3: '',
            field4: 'nested',
          },
        },
        simple: 'test',
      })
    })

    it('should handle arrays correctly', () => {
      const input = {
        array: [1, 2, 3],
        nested: {
          array: ['a', null, 'c'],
        },
      }
      const result = deepSanitizeFormValues(input)

      expect(result).toEqual({
        array: [1, 2, 3],
        nested: {
          array: ['a', null, 'c'],
        },
      })
    })

    it('should handle null and undefined at root level', () => {
      const input = {
        null_field: null,
        undefined_field: undefined,
        nested: {
          null_nested: null,
        },
      }
      const result = deepSanitizeFormValues(input)

      expect(result).toEqual({
        null_field: '',
        undefined_field: '',
        nested: {
          null_nested: '',
        },
      })
    })

    it('should handle deeply nested structures', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              field: null,
            },
          },
        },
      }
      const result = deepSanitizeFormValues(input)

      expect(result).toEqual({
        level1: {
          level2: {
            level3: {
              field: '',
            },
          },
        },
      })
    })

    it('should preserve non-null values in nested structures', () => {
      const input = {
        config: {
          client_id: 'valid_id',
          client_secret: null,
          options: {
            timeout: 5000,
            enabled: true,
            message: undefined,
          },
        },
      }
      const result = deepSanitizeFormValues(input)

      expect(result).toEqual({
        config: {
          client_id: 'valid_id',
          client_secret: '',
          options: {
            timeout: 5000,
            enabled: true,
            message: '',
          },
        },
      })
    })
  })

  describe('findMissingRequiredField', () => {
    const requiredFields = [
      { name: 'client_id', label: 'Client ID' },
      { name: 'client_secret', label: 'Client Secret' },
      { name: 'scope', label: 'Scope' },
    ]

    it('should return null when all required fields are present', () => {
      const formData = {
        client_id: 'test_id',
        client_secret: 'test_secret',
        scope: 'read',
        optional_field: 'optional',
      }

      const result = findMissingRequiredField(formData, requiredFields)
      expect(result).toBeNull()
    })

    it('should return the first missing field', () => {
      const formData = {
        client_id: 'test_id',
        scope: 'read',
      }

      const result = findMissingRequiredField(formData, requiredFields)
      expect(result).toEqual({ name: 'client_secret', label: 'Client Secret' })
    })

    it('should treat empty strings as missing fields', () => {
      const formData = {
        client_id: '',
        client_secret: 'test_secret',
        scope: 'read',
      }

      const result = findMissingRequiredField(formData, requiredFields)
      expect(result).toEqual({ name: 'client_id', label: 'Client ID' })
    })

    it('should treat null values as missing fields', () => {
      const formData = {
        client_id: 'test_id',
        client_secret: null,
        scope: 'read',
      }

      const result = findMissingRequiredField(formData, requiredFields)
      expect(result).toEqual({ name: 'client_secret', label: 'Client Secret' })
    })

    it('should treat undefined values as missing fields', () => {
      const formData = {
        client_id: 'test_id',
        client_secret: 'test_secret',
        scope: undefined,
      }

      const result = findMissingRequiredField(formData, requiredFields)
      expect(result).toEqual({ name: 'scope', label: 'Scope' })
    })

    it('should handle empty required fields array', () => {
      const formData = {
        client_id: 'test_id',
      }

      const result = findMissingRequiredField(formData, [])
      expect(result).toBeNull()
    })

    it('should handle empty form data', () => {
      const result = findMissingRequiredField({}, requiredFields)
      expect(result).toEqual({ name: 'client_id', label: 'Client ID' })
    })

    it('should handle multilingual labels', () => {
      const multilingualFields = [
        { name: 'field1', label: { en_US: 'Field 1 EN', zh_Hans: 'Field 1 CN' } },
      ]
      const formData = {}

      const result = findMissingRequiredField(formData, multilingualFields)
      expect(result).toEqual({
        name: 'field1',
        label: { en_US: 'Field 1 EN', zh_Hans: 'Field 1 CN' },
      })
    })

    it('should return null for form data with extra fields', () => {
      const formData = {
        client_id: 'test_id',
        client_secret: 'test_secret',
        scope: 'read',
        extra_field1: 'extra1',
        extra_field2: 'extra2',
      }

      const result = findMissingRequiredField(formData, requiredFields)
      expect(result).toBeNull()
    })
  })

  describe('Edge cases', () => {
    it('should handle objects with non-string keys', () => {
      const input = { [Symbol('test')]: 'value', regular: 'field' } as any
      const result = sanitizeFormValues(input)

      expect(result.regular).toBe('field')
    })

    it('should handle objects with getter properties', () => {
      const obj = {}
      Object.defineProperty(obj, 'getter', {
        get: () => 'computed_value',
        enumerable: true,
      })

      const result = sanitizeFormValues(obj)
      expect(result.getter).toBe('computed_value')
    })

    it('should handle circular references in deepSanitizeFormValues gracefully', () => {
      const obj: any = { field: 'value' }
      obj.circular = obj

      expect(() => deepSanitizeFormValues(obj)).not.toThrow()
    })
  })
})
