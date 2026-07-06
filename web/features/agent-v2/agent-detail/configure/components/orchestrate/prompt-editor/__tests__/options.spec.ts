import { describe, expect, it } from 'vitest'
import { replaceTextRangeWithToken, replaceTrailingSlashWithToken } from '../options'

describe('prompt editor token replacement', () => {
  // Replacing the tracked slash range keeps insertion at the user's caret instead of appending.
  describe('replaceTextRangeWithToken', () => {
    it('should replace a slash in the middle of the prompt', () => {
      expect(replaceTextRangeWithToken(
        'Review / before replying',
        { start: 7, end: 8 },
        '[§file:file-1:Spec§]',
      )).toBe('Review [§file:file-1:Spec§] before replying')
    })

    it('should add spacing when the slash is adjacent to text', () => {
      expect(replaceTextRangeWithToken(
        'Review/now',
        { start: 6, end: 7 },
        '[§skill:analysis:Analysis§]',
      )).toBe('Review [§skill:analysis:Analysis§] now')
    })

    it('should clamp out-of-bound ranges before replacing', () => {
      expect(replaceTextRangeWithToken(
        'Review/',
        { start: 6, end: 99 },
        '[§knowledge:kb-1:KB§]',
      )).toBe('Review [§knowledge:kb-1:KB§]')
    })
  })

  // Existing fallback behavior is retained for callers that only know about a trailing slash.
  describe('replaceTrailingSlashWithToken', () => {
    it('should replace a trailing slash', () => {
      expect(replaceTrailingSlashWithToken(
        'Review /',
        '[§file:file-1:Spec§]',
      )).toBe('Review [§file:file-1:Spec§]')
    })

    it('should append when no trailing slash exists', () => {
      expect(replaceTrailingSlashWithToken(
        'Review',
        '[§file:file-1:Spec§]',
      )).toBe('Review [§file:file-1:Spec§]')
    })
  })
})
