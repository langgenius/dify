import { describe, expect, it } from 'vitest'
import { indexMethodIcon, retrievalIcon } from '../icons'

describe('create/icons', () => {
  // Verify icon map exports have expected keys
  describe('indexMethodIcon', () => {
    it('should have high_quality and economical keys', () => {
      expect(indexMethodIcon).toHaveProperty('high_quality')
      expect(indexMethodIcon).toHaveProperty('economical')
    })

    it('should have truthy values for each key', () => {
      expect(indexMethodIcon.high_quality).toBeTruthy()
      expect(indexMethodIcon.economical).toBeTruthy()
    })
  })

  describe('retrievalIcon', () => {
    it('should have vector, fullText, and hybrid keys', () => {
      expect(retrievalIcon).toHaveProperty('vector')
      expect(retrievalIcon).toHaveProperty('fullText')
      expect(retrievalIcon).toHaveProperty('hybrid')
    })

    it('should have truthy values for each key', () => {
      expect(retrievalIcon.vector).toBeTruthy()
      expect(retrievalIcon.fullText).toBeTruthy()
      expect(retrievalIcon.hybrid).toBeTruthy()
    })
  })
})
