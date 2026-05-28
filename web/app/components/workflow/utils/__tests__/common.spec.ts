import {
  formatWorkflowRunIdentifier,
  getKeyboardKeyCodeBySystem,
} from '../common'

const setUserAgent = (userAgent: string) => {
  Object.defineProperty(navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  })
}

describe('getKeyboardKeyCodeBySystem', () => {
  const originalUserAgent = navigator.userAgent

  afterEach(() => {
    setUserAgent(originalUserAgent)
  })

  it('should map ctrl to meta on macOS', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')

    expect(getKeyboardKeyCodeBySystem('ctrl')).toBe('meta')
  })

  it('should keep ctrl on non-macOS', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')

    expect(getKeyboardKeyCodeBySystem('ctrl')).toBe('ctrl')
  })

  it('should keep unmapped keys on macOS', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')

    expect(getKeyboardKeyCodeBySystem('shift')).toBe('shift')
  })
})

describe('formatWorkflowRunIdentifier', () => {
  it('should return fallback text when finishedAt is undefined', () => {
    expect(formatWorkflowRunIdentifier()).toBe(' (Running)')
  })

  it('should return fallback text when finishedAt is 0', () => {
    expect(formatWorkflowRunIdentifier(0)).toBe(' (Running)')
  })

  it('should capitalize custom fallback text', () => {
    expect(formatWorkflowRunIdentifier(undefined, 'pending')).toBe(' (Pending)')
  })

  it('should format a valid timestamp', () => {
    const timestamp = 1704067200 // 2024-01-01 00:00:00 UTC
    const result = formatWorkflowRunIdentifier(timestamp)
    expect(result).toMatch(/^ \(\d{2}:\d{2}:\d{2}( [AP]M)?\)$/)
  })

  it('should handle single-char fallback text', () => {
    expect(formatWorkflowRunIdentifier(undefined, 'x')).toBe(' (X)')
  })
})
