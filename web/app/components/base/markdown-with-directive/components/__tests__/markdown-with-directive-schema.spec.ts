import { validateDirectiveProps } from '../markdown-with-directive-schema'

describe('markdown-with-directive-schema', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Validate the happy path for known directives.
  describe('valid props', () => {
    it('should return true for withiconcardlist when className is provided', () => {
      expect(validateDirectiveProps('withiconcardlist', { className: 'custom-list' })).toBe(true)
    })

    it('should return true for withiconcarditem when icon is https URL', () => {
      expect(validateDirectiveProps('withiconcarditem', { icon: 'https://example.com/icon.png' })).toBe(true)
    })
  })

  // Validate strict schema constraints and error branches.
  describe('invalid props', () => {
    it('should return false and log error for unknown directive name', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const isValid = validateDirectiveProps('unknown-directive', { className: 'custom-list' })

      expect(isValid).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[markdown-with-directive] Unknown directive name.',
        expect.objectContaining({
          attributes: { className: 'custom-list' },
          directive: 'unknown-directive',
        }),
      )
    })

    it('should return false and log error for non-http icon URL', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const isValid = validateDirectiveProps('withiconcarditem', { icon: 'ftp://example.com/icon.png' })

      expect(isValid).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[markdown-with-directive] Invalid directive props.',
        expect.objectContaining({
          attributes: { icon: 'ftp://example.com/icon.png' },
          directive: 'withiconcarditem',
          issues: expect.arrayContaining([
            expect.objectContaining({
              path: 'icon',
            }),
          ]),
        }),
      )
    })

    it('should return false when extra field is provided to strict list schema', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const isValid = validateDirectiveProps('withiconcardlist', {
        className: 'custom-list',
        extra: 'not-allowed',
      })

      expect(isValid).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[markdown-with-directive] Invalid directive props.',
        expect.objectContaining({
          directive: 'withiconcardlist',
        }),
      )
    })
  })
})
