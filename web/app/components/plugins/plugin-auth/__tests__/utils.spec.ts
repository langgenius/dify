import { describe, expect, it } from 'vitest'
import { transformFormSchemasSecretInput } from '../utils'

describe('plugin-auth/utils', () => {
  describe('transformFormSchemasSecretInput', () => {
    it('replaces secret input values with [__HIDDEN__]', () => {
      const values = { api_key: 'sk-12345', username: 'admin' }
      const result = transformFormSchemasSecretInput(['api_key'], values)
      expect(result.api_key).toBe('[__HIDDEN__]')
      expect(result.username).toBe('admin')
    })

    it('does not replace falsy values (empty string)', () => {
      const values = { api_key: '', username: 'admin' }
      const result = transformFormSchemasSecretInput(['api_key'], values)
      expect(result.api_key).toBe('')
    })

    it('does not replace undefined values', () => {
      const values = { username: 'admin' }
      const result = transformFormSchemasSecretInput(['api_key'], values)
      expect(result.api_key).toBeUndefined()
    })

    it('handles multiple secret fields', () => {
      const values = { key1: 'secret1', key2: 'secret2', normal: 'value' }
      const result = transformFormSchemasSecretInput(['key1', 'key2'], values)
      expect(result.key1).toBe('[__HIDDEN__]')
      expect(result.key2).toBe('[__HIDDEN__]')
      expect(result.normal).toBe('value')
    })

    it('does not mutate the original values', () => {
      const values = { api_key: 'sk-12345' }
      const result = transformFormSchemasSecretInput(['api_key'], values)
      expect(result).not.toBe(values)
      expect(values.api_key).toBe('sk-12345')
    })

    it('returns same values when no secret names provided', () => {
      const values = { api_key: 'sk-12345', username: 'admin' }
      const result = transformFormSchemasSecretInput([], values)
      expect(result).toEqual(values)
    })

    it('handles null-like values correctly', () => {
      const values = { key: null, key2: 0, key3: false }
      const result = transformFormSchemasSecretInput(['key', 'key2', 'key3'], values)
      // null, 0, false are falsy — should not be replaced
      expect(result.key).toBeNull()
      expect(result.key2).toBe(0)
      expect(result.key3).toBe(false)
    })
  })
})
