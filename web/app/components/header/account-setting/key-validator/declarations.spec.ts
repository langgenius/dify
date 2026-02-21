import { describe, expect, it } from 'vitest'
import { ValidatedStatus } from './declarations'

describe('declarations', () => {
  describe('ValidatedStatus', () => {
    it('should expose expected status values', () => {
      expect(ValidatedStatus.Success).toBe('success')
      expect(ValidatedStatus.Error).toBe('error')
      expect(ValidatedStatus.Exceed).toBe('exceed')
    })
  })
})
