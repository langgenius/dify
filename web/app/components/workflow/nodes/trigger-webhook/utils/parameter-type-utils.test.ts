import {
  createParameterTypeOptions,
  getAvailableParameterTypes,
  isValidParameterType,
  normalizeParameterType,
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
