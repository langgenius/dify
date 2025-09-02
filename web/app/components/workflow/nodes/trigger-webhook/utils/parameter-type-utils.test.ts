import {
  createParameterTypeOptions,
  getAvailableParameterTypes,
  getParameterTypeDisplayName,
  isValidParameterType,
  normalizeParameterType,
  validateParameterValue,
} from './parameter-type-utils'

describe('Parameter Type Utils', () => {
  describe('isValidParameterType', () => {
    it('should validate specific array types', () => {
      expect(isValidParameterType('array[string]')).toBe(true)
      expect(isValidParameterType('array[number]')).toBe(true)
      expect(isValidParameterType('array[boolean]')).toBe(true)
      expect(isValidParameterType('array[object]')).toBe(true)
    })

    it('should validate basic types', () => {
      expect(isValidParameterType('string')).toBe(true)
      expect(isValidParameterType('number')).toBe(true)
      expect(isValidParameterType('boolean')).toBe(true)
      expect(isValidParameterType('object')).toBe(true)
      expect(isValidParameterType('file')).toBe(true)
    })

    it('should reject invalid types', () => {
      expect(isValidParameterType('array')).toBe(false)
      expect(isValidParameterType('invalid')).toBe(false)
      expect(isValidParameterType('array[invalid]')).toBe(false)
    })
  })

  describe('normalizeParameterType', () => {
    it('should normalize valid types', () => {
      expect(normalizeParameterType('string')).toBe('string')
      expect(normalizeParameterType('array[string]')).toBe('array[string]')
    })

    it('should migrate legacy array type', () => {
      expect(normalizeParameterType('array')).toBe('array[string]')
    })

    it('should default to string for invalid types', () => {
      expect(normalizeParameterType('invalid')).toBe('string')
    })
  })

  describe('getParameterTypeDisplayName', () => {
    it('should return correct display names for array types', () => {
      expect(getParameterTypeDisplayName('array[string]')).toBe('Array[String]')
      expect(getParameterTypeDisplayName('array[number]')).toBe('Array[Number]')
      expect(getParameterTypeDisplayName('array[boolean]')).toBe('Array[Boolean]')
      expect(getParameterTypeDisplayName('array[object]')).toBe('Array[Object]')
    })

    it('should return correct display names for basic types', () => {
      expect(getParameterTypeDisplayName('string')).toBe('String')
      expect(getParameterTypeDisplayName('number')).toBe('Number')
      expect(getParameterTypeDisplayName('boolean')).toBe('Boolean')
      expect(getParameterTypeDisplayName('object')).toBe('Object')
      expect(getParameterTypeDisplayName('file')).toBe('File')
    })
  })

  describe('validateParameterValue', () => {
    it('should validate string values', () => {
      expect(validateParameterValue('test', 'string')).toBe(true)
      expect(validateParameterValue('', 'string')).toBe(true)
      expect(validateParameterValue(123, 'string')).toBe(false)
    })

    it('should validate number values', () => {
      expect(validateParameterValue(123, 'number')).toBe(true)
      expect(validateParameterValue(123.45, 'number')).toBe(true)
      expect(validateParameterValue('abc', 'number')).toBe(false)
      expect(validateParameterValue(Number.NaN, 'number')).toBe(false)
    })

    it('should validate boolean values', () => {
      expect(validateParameterValue(true, 'boolean')).toBe(true)
      expect(validateParameterValue(false, 'boolean')).toBe(true)
      expect(validateParameterValue('true', 'boolean')).toBe(false)
    })

    it('should validate array values', () => {
      expect(validateParameterValue(['a', 'b'], 'array[string]')).toBe(true)
      expect(validateParameterValue([1, 2, 3], 'array[number]')).toBe(true)
      expect(validateParameterValue([true, false], 'array[boolean]')).toBe(true)
      expect(validateParameterValue([{ key: 'value' }], 'array[object]')).toBe(true)
      expect(validateParameterValue(['a', 1], 'array[string]')).toBe(false)
      expect(validateParameterValue('not an array', 'array[string]')).toBe(false)
    })

    it('should validate object values', () => {
      expect(validateParameterValue({ key: 'value' }, 'object')).toBe(true)
      expect(validateParameterValue({}, 'object')).toBe(true)
      expect(validateParameterValue(null, 'object')).toBe(false)
      expect(validateParameterValue([], 'object')).toBe(false)
      expect(validateParameterValue('string', 'object')).toBe(false)
    })

    it('should validate file values', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' })
      expect(validateParameterValue(mockFile, 'file')).toBe(true)
      expect(validateParameterValue({ name: 'file.txt' }, 'file')).toBe(true)
      expect(validateParameterValue('not a file', 'file')).toBe(false)
    })

    it('should return false for invalid types', () => {
      expect(validateParameterValue('test', 'invalid' as any)).toBe(false)
    })
  })

  describe('getAvailableParameterTypes', () => {
    it('should return only string for non-request body', () => {
      const types = getAvailableParameterTypes('application/json', false)
      expect(types).toEqual(['string'])
    })

    it('should return all types for application/json', () => {
      const types = getAvailableParameterTypes('application/json', true)
      expect(types).toContain('string')
      expect(types).toContain('number')
      expect(types).toContain('boolean')
      expect(types).toContain('array[string]')
      expect(types).toContain('array[number]')
      expect(types).toContain('array[boolean]')
      expect(types).toContain('array[object]')
      expect(types).toContain('object')
    })

    it('should include file type for multipart/form-data', () => {
      const types = getAvailableParameterTypes('multipart/form-data', true)
      expect(types).toContain('file')
    })
  })

  describe('createParameterTypeOptions', () => {
    it('should create options with display names', () => {
      const options = createParameterTypeOptions('application/json', true)
      const stringOption = options.find(opt => opt.value === 'string')
      const arrayStringOption = options.find(opt => opt.value === 'array[string]')

      expect(stringOption?.name).toBe('String')
      expect(arrayStringOption?.name).toBe('Array[String]')
    })
  })
})
