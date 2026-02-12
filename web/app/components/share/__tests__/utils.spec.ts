import { describe, expect, it } from 'vitest'
import { getInitialTokenV2, isTokenV1 } from '../utils'

describe('utils', () => {
  describe('isTokenV1', () => {
    it('should return true when token has no version property', () => {
      const token = { someKey: 'value' }
      expect(isTokenV1(token)).toBe(true)
    })

    it('should return true when token.version is undefined', () => {
      const token = { version: undefined }
      expect(isTokenV1(token)).toBe(true)
    })

    it('should return true when token.version is null', () => {
      const token = { version: null }
      expect(isTokenV1(token)).toBe(true)
    })

    it('should return true when token.version is 0', () => {
      const token = { version: 0 }
      expect(isTokenV1(token)).toBe(true)
    })

    it('should return true when token.version is empty string', () => {
      const token = { version: '' }
      expect(isTokenV1(token)).toBe(true)
    })

    it('should return false when token has version 1', () => {
      const token = { version: 1 }
      expect(isTokenV1(token)).toBe(false)
    })

    it('should return false when token has version 2', () => {
      const token = { version: 2 }
      expect(isTokenV1(token)).toBe(false)
    })

    it('should return false when token has string version', () => {
      const token = { version: '2' }
      expect(isTokenV1(token)).toBe(false)
    })

    it('should handle empty object', () => {
      const token = {}
      expect(isTokenV1(token)).toBe(true)
    })
  })

  describe('getInitialTokenV2', () => {
    it('should return object with version 2', () => {
      const token = getInitialTokenV2()
      expect(token.version).toBe(2)
    })

    it('should return a new object each time', () => {
      const token1 = getInitialTokenV2()
      const token2 = getInitialTokenV2()
      expect(token1).not.toBe(token2)
    })

    it('should return an object that can be modified without affecting future calls', () => {
      const token1 = getInitialTokenV2()
      token1.customField = 'test'
      const token2 = getInitialTokenV2()
      expect(token2.customField).toBeUndefined()
    })
  })
})
