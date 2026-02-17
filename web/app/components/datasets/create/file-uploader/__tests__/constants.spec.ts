import { describe, expect, it } from 'vitest'
import {
  PROGRESS_COMPLETE,
  PROGRESS_ERROR,
  PROGRESS_NOT_STARTED,
} from '../constants'

describe('file-uploader constants', () => {
  // Verify progress sentinel values
  describe('Progress Sentinels', () => {
    it('should define PROGRESS_NOT_STARTED as -1', () => {
      expect(PROGRESS_NOT_STARTED).toBe(-1)
    })

    it('should define PROGRESS_ERROR as -2', () => {
      expect(PROGRESS_ERROR).toBe(-2)
    })

    it('should define PROGRESS_COMPLETE as 100', () => {
      expect(PROGRESS_COMPLETE).toBe(100)
    })

    it('should have distinct values for all sentinels', () => {
      const values = [PROGRESS_NOT_STARTED, PROGRESS_ERROR, PROGRESS_COMPLETE]
      expect(new Set(values).size).toBe(values.length)
    })

    it('should have negative values for non-progress states', () => {
      expect(PROGRESS_NOT_STARTED).toBeLessThan(0)
      expect(PROGRESS_ERROR).toBeLessThan(0)
    })
  })
})
