import { describe, expect, it } from 'vitest'
import {
  ACCEPT_TYPES,
  DEFAULT_IMAGE_FILE_BATCH_LIMIT,
  DEFAULT_IMAGE_FILE_SIZE_LIMIT,
  DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
} from '../constants'

describe('image-uploader constants', () => {
  // Verify accepted image types
  describe('ACCEPT_TYPES', () => {
    it('should include standard image formats', () => {
      expect(ACCEPT_TYPES).toContain('jpg')
      expect(ACCEPT_TYPES).toContain('jpeg')
      expect(ACCEPT_TYPES).toContain('png')
      expect(ACCEPT_TYPES).toContain('gif')
    })

    it('should have exactly 4 types', () => {
      expect(ACCEPT_TYPES).toHaveLength(4)
    })
  })

  // Verify numeric limits are positive
  describe('Limits', () => {
    it('should have a positive file size limit', () => {
      expect(DEFAULT_IMAGE_FILE_SIZE_LIMIT).toBeGreaterThan(0)
      expect(DEFAULT_IMAGE_FILE_SIZE_LIMIT).toBe(2)
    })

    it('should have a positive batch limit', () => {
      expect(DEFAULT_IMAGE_FILE_BATCH_LIMIT).toBeGreaterThan(0)
      expect(DEFAULT_IMAGE_FILE_BATCH_LIMIT).toBe(5)
    })

    it('should have a positive single chunk attachment limit', () => {
      expect(DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT).toBeGreaterThan(0)
      expect(DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT).toBe(10)
    })
  })
})
