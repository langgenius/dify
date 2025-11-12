import { writeTextToClipboard } from './clipboard'

describe('Clipboard Utilities', () => {
  describe('writeTextToClipboard', () => {
    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('should use navigator.clipboard.writeText when available', async () => {
      const mockWriteText = jest.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      })

      await writeTextToClipboard('test text')
      expect(mockWriteText).toHaveBeenCalledWith('test text')
    })

    it('should fallback to execCommand when clipboard API not available', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      const mockExecCommand = jest.fn().mockReturnValue(true)
      document.execCommand = mockExecCommand

      const appendChildSpy = jest.spyOn(document.body, 'appendChild')
      const removeChildSpy = jest.spyOn(document.body, 'removeChild')

      await writeTextToClipboard('fallback text')

      expect(appendChildSpy).toHaveBeenCalled()
      expect(mockExecCommand).toHaveBeenCalledWith('copy')
      expect(removeChildSpy).toHaveBeenCalled()
    })

    it('should handle execCommand failure', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      const mockExecCommand = jest.fn().mockReturnValue(false)
      document.execCommand = mockExecCommand

      await expect(writeTextToClipboard('fail text')).rejects.toThrow()
    })

    it('should handle execCommand exception', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      const mockExecCommand = jest.fn().mockImplementation(() => {
        throw new Error('execCommand error')
      })
      document.execCommand = mockExecCommand

      await expect(writeTextToClipboard('error text')).rejects.toThrow('execCommand error')
    })

    it('should clean up textarea after fallback', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      document.execCommand = jest.fn().mockReturnValue(true)
      const removeChildSpy = jest.spyOn(document.body, 'removeChild')

      await writeTextToClipboard('cleanup test')

      expect(removeChildSpy).toHaveBeenCalled()
    })

    it('should handle empty string', async () => {
      const mockWriteText = jest.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      })

      await writeTextToClipboard('')
      expect(mockWriteText).toHaveBeenCalledWith('')
    })

    it('should handle special characters', async () => {
      const mockWriteText = jest.fn().mockResolvedValue(undefined)
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
