import { describe, expect, it } from 'vitest'
import { insertTokenAtTextRange, replaceTrailingSlashWithToken } from '../options'

describe('prompt editor token replacement', () => {
  // Replacing the tracked slash range keeps insertion at the user's caret instead of appending.
  describe('insertTokenAtTextRange', () => {
    it('should replace a slash in the middle of the prompt and place the cursor after the token', () => {
      expect(insertTokenAtTextRange(
        'Review / before replying',
        { start: 7, end: 8 },
        '[§file:file-1:Spec§]',
      )).toEqual({
        value: 'Review [§file:file-1:Spec§] before replying',
        cursorOffset: 'Review [§file:file-1:Spec§]'.length,
      })
    })

    it('should add spacing when the slash is adjacent to text and place the cursor after the spacer', () => {
      expect(insertTokenAtTextRange(
        'Review/now',
        { start: 6, end: 7 },
        '[§skill:analysis:Analysis§]',
      )).toEqual({
        value: 'Review [§skill:analysis:Analysis§] now',
        cursorOffset: 'Review [§skill:analysis:Analysis§] '.length,
      })
    })

    it('should clamp out-of-bound ranges before replacing', () => {
      expect(insertTokenAtTextRange(
        'Review/',
        { start: 6, end: 99 },
        '[§knowledge:kb-1:KB§]',
      )).toEqual({
        value: 'Review [§knowledge:kb-1:KB§]',
        cursorOffset: 'Review [§knowledge:kb-1:KB§]'.length,
      })
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
