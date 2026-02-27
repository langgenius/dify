/**
 * Test suite for clipboard utilities
 *
 * This module provides cross-browser clipboard functionality with automatic fallback:
 * 1. Modern Clipboard API (navigator.clipboard.writeText) - preferred method
 * 2. Legacy execCommand('copy') - fallback for older browsers
 *
 * The implementation ensures clipboard operations work across all supported browsers
 * while gracefully handling permissions and API availability.
 */
import { writeTextToClipboard } from './clipboard'

describe('Clipboard Utilities', () => {
  describe('writeTextToClipboard', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    /**
     * Test modern Clipboard API usage
     * When navigator.clipboard is available, should use the modern API
     */
    it('should use navigator.clipboard.writeText when available', async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      })

      await writeTextToClipboard('test text')
      expect(mockWriteText).toHaveBeenCalledWith('test text')
    })

    /**
     * Test fallback to legacy execCommand method
     * When Clipboard API is unavailable, should use document.execCommand('copy')
     * This involves creating a temporary textarea element
     */
    it('should fallback to execCommand when clipboard API not available', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      const mockExecCommand = vi.fn().mockReturnValue(true)
      document.execCommand = mockExecCommand

      const appendChildSpy = vi.spyOn(document.body, 'appendChild')
      const removeChildSpy = vi.spyOn(document.body, 'removeChild')

      await writeTextToClipboard('fallback text')

      expect(appendChildSpy).toHaveBeenCalled()
      expect(mockExecCommand).toHaveBeenCalledWith('copy')
      expect(removeChildSpy).toHaveBeenCalled()
    })

    /**
     * Test error handling when execCommand returns false
     * execCommand returns false when the operation fails
     */
    it('should handle execCommand failure', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      const mockExecCommand = vi.fn().mockReturnValue(false)
      document.execCommand = mockExecCommand

      await expect(writeTextToClipboard('fail text')).rejects.toThrow()
    })

    /**
     * Test error handling when execCommand throws an exception
     * Should propagate the error to the caller
     */
    it('should handle execCommand exception', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      const mockExecCommand = vi.fn().mockImplementation(() => {
        throw new Error('execCommand error')
      })
      document.execCommand = mockExecCommand

      await expect(writeTextToClipboard('error text')).rejects.toThrow('execCommand error')
    })

    /**
     * Test proper cleanup of temporary DOM elements
     * The temporary textarea should be removed after copying
     */
    it('should clean up textarea after fallback', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      document.execCommand = vi.fn().mockReturnValue(true)
      const removeChildSpy = vi.spyOn(document.body, 'removeChild')

      await writeTextToClipboard('cleanup test')

      expect(removeChildSpy).toHaveBeenCalled()
    })

    /**
     * Test copying empty strings
     * Should handle edge case of empty clipboard content
     */
    it('should handle empty string', async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      })

      await writeTextToClipboard('')
      expect(mockWriteText).toHaveBeenCalledWith('')
    })

    /**
     * Test copying text with special characters
     * Should preserve newlines, tabs, quotes, unicode, and emojis
     */
    it('should handle special characters', async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      })

      const specialText = 'Test\n\t"quotes"\n中文\n😀'
      await writeTextToClipboard(specialText)
      expect(mockWriteText).toHaveBeenCalledWith(specialText)
    })
  })
})
