import { describe, expect, it } from 'vitest'
import { DataType } from '../../types'
import { getIconClassName } from '../get-icon'

describe('getIconClassName', () => {
  describe('Rendering', () => {
    it('should return text snippet icon class for DataType.string', () => {
      const result = getIconClassName(DataType.string)
      expect(result).toBe('i-ri-text-snippet')
    })

    it('should return hashtag icon class for DataType.number', () => {
      const result = getIconClassName(DataType.number)
      expect(result).toBe('i-ri-hashtag')
    })

    it('should return time line icon class for DataType.time', () => {
      const result = getIconClassName(DataType.time)
      expect(result).toBe('i-ri-time-line')
    })
  })

  describe('Edge Cases', () => {
    it('should return text snippet class as fallback for unknown type', () => {
      const result = getIconClassName('unknown' as DataType)
      expect(result).toBe('i-ri-text-snippet')
    })

    it('should return text snippet class for undefined type', () => {
      const result = getIconClassName(undefined as unknown as DataType)
      expect(result).toBe('i-ri-text-snippet')
    })

    it('should return text snippet class for null type', () => {
      const result = getIconClassName(null as unknown as DataType)
      expect(result).toBe('i-ri-text-snippet')
    })

    it('should return text snippet class for empty string type', () => {
      const result = getIconClassName('' as DataType)
      expect(result).toBe('i-ri-text-snippet')
    })
  })
})
