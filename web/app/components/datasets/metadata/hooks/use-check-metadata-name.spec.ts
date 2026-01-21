import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import useCheckMetadataName from './use-check-metadata-name'

describe('useCheckMetadataName', () => {
  describe('Hook Initialization', () => {
    it('should return an object with checkName function', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      expect(result.current).toHaveProperty('checkName')
      expect(typeof result.current.checkName).toBe('function')
    })
  })

  describe('checkName - Empty Name Validation', () => {
    it('should return error for empty string', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('')
      expect(errorMsg).toBeTruthy()
    })

    it('should return error for whitespace-only string', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      // Whitespace is not valid since it doesn't match the pattern
      const { errorMsg } = result.current.checkName('   ')
      expect(errorMsg).toBeTruthy()
    })
  })

  describe('checkName - Pattern Validation', () => {
    it('should return error for name starting with number', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('1name')
      expect(errorMsg).toBeTruthy()
    })

    it('should return error for name starting with uppercase', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('Name')
      expect(errorMsg).toBeTruthy()
    })

    it('should return error for name starting with underscore', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('_name')
      expect(errorMsg).toBeTruthy()
    })

    it('should return error for name with spaces', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('my name')
      expect(errorMsg).toBeTruthy()
    })

    it('should return error for name with special characters', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('name-with-dash')
      expect(errorMsg).toBeTruthy()
    })

    it('should return error for name with dots', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('name.with.dot')
      expect(errorMsg).toBeTruthy()
    })

    it('should accept valid name starting with lowercase letter', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('validname')
      expect(errorMsg).toBe('')
    })

    it('should accept valid name with numbers after first character', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('name123')
      expect(errorMsg).toBe('')
    })

    it('should accept valid name with underscores after first character', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('name_with_underscore')
      expect(errorMsg).toBe('')
    })

    it('should accept single lowercase letter', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('a')
      expect(errorMsg).toBe('')
    })
  })

  describe('checkName - Length Validation', () => {
    it('should return error for name longer than 255 characters', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const longName = 'a'.repeat(256)
      const { errorMsg } = result.current.checkName(longName)
      expect(errorMsg).toBeTruthy()
    })

    it('should accept name with exactly 255 characters', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const maxLengthName = 'a'.repeat(255)
      const { errorMsg } = result.current.checkName(maxLengthName)
      expect(errorMsg).toBe('')
    })

    it('should accept name with less than 255 characters', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const shortName = 'a'.repeat(100)
      const { errorMsg } = result.current.checkName(shortName)
      expect(errorMsg).toBe('')
    })
  })

  describe('checkName - Edge Cases', () => {
    it('should validate all lowercase letters', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('abcdefghijklmnopqrstuvwxyz')
      expect(errorMsg).toBe('')
    })

    it('should validate name with mixed numbers and underscores', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('a1_2_3_test')
      expect(errorMsg).toBe('')
    })

    it('should reject uppercase letters anywhere in name', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('nameWithUppercase')
      expect(errorMsg).toBeTruthy()
    })

    it('should reject unicode characters', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('名字')
      expect(errorMsg).toBeTruthy()
    })

    it('should reject emoji characters', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('name😀')
      expect(errorMsg).toBeTruthy()
    })
  })

  describe('Return Value Structure', () => {
    it('should return object with errorMsg property', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const returnValue = result.current.checkName('test')
      expect(returnValue).toHaveProperty('errorMsg')
    })

    it('should return empty string for valid name', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('valid_name')
      expect(errorMsg).toBe('')
    })

    it('should return non-empty string for invalid name', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const { errorMsg } = result.current.checkName('')
      expect(typeof errorMsg).toBe('string')
      expect(errorMsg.length).toBeGreaterThan(0)
    })
  })
})
