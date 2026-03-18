import {
  formatWorkflowRunIdentifier,
  getKeyboardKeyCodeBySystem,
  getKeyboardKeyNameBySystem,
  isEventTargetInputArea,
  isMac,
} from '../common'

describe('isMac', () => {
  const originalNavigator = globalThis.navigator

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
  })

  it('should return true when userAgent contains MAC', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      writable: true,
      configurable: true,
    })
    expect(isMac()).toBe(true)
  })

  it('should return false when userAgent does not contain MAC', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      writable: true,
      configurable: true,
    })
    expect(isMac()).toBe(false)
  })
})

describe('getKeyboardKeyNameBySystem', () => {
  const originalNavigator = globalThis.navigator

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
  })

  function setMac() {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Macintosh' },
      writable: true,
      configurable: true,
    })
  }

  function setWindows() {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Windows NT' },
      writable: true,
      configurable: true,
    })
  }

  it('should map ctrl to ⌘ on Mac', () => {
    setMac()
    expect(getKeyboardKeyNameBySystem('ctrl')).toBe('⌘')
  })

  it('should map alt to ⌥ on Mac', () => {
    setMac()
    expect(getKeyboardKeyNameBySystem('alt')).toBe('⌥')
  })

  it('should map shift to ⇧ on Mac', () => {
    setMac()
    expect(getKeyboardKeyNameBySystem('shift')).toBe('⇧')
  })

  it('should return the original key for unmapped keys on Mac', () => {
    setMac()
    expect(getKeyboardKeyNameBySystem('enter')).toBe('enter')
  })

  it('should return the original key on non-Mac', () => {
    setWindows()
    expect(getKeyboardKeyNameBySystem('ctrl')).toBe('ctrl')
    expect(getKeyboardKeyNameBySystem('alt')).toBe('alt')
  })
})

describe('getKeyboardKeyCodeBySystem', () => {
  const originalNavigator = globalThis.navigator

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
  })

  it('should map ctrl to meta on Mac', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Macintosh' },
      writable: true,
      configurable: true,
    })
    expect(getKeyboardKeyCodeBySystem('ctrl')).toBe('meta')
  })

  it('should return the original key on non-Mac', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Windows NT' },
      writable: true,
      configurable: true,
    })
    expect(getKeyboardKeyCodeBySystem('ctrl')).toBe('ctrl')
  })

  it('should return the original key for unmapped keys on Mac', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Macintosh' },
      writable: true,
      configurable: true,
    })
    expect(getKeyboardKeyCodeBySystem('alt')).toBe('alt')
  })
})

describe('isEventTargetInputArea', () => {
  it('should return true for INPUT elements', () => {
    const el = document.createElement('input')
    expect(isEventTargetInputArea(el)).toBe(true)
  })

  it('should return true for TEXTAREA elements', () => {
    const el = document.createElement('textarea')
    expect(isEventTargetInputArea(el)).toBe(true)
  })

  it('should return true for contentEditable elements', () => {
    const el = document.createElement('div')
    el.contentEditable = 'true'
    expect(isEventTargetInputArea(el)).toBe(true)
  })

  it('should return undefined for non-input elements', () => {
    const el = document.createElement('div')
    expect(isEventTargetInputArea(el)).toBeUndefined()
  })

  it('should return undefined for contentEditable=false elements', () => {
    const el = document.createElement('div')
    el.contentEditable = 'false'
    expect(isEventTargetInputArea(el)).toBeUndefined()
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
