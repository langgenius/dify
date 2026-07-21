import { describe, expect, it } from 'vitest'
import { resolveE2EBrowser } from '../test-env'

describe('resolveE2EBrowser', () => {
  it('uses Chromium by default', () => {
    expect(resolveE2EBrowser(undefined)).toBe('chromium')
  })

  it.each(['chromium', 'webkit'] as const)('accepts %s', (browser) => {
    expect(resolveE2EBrowser(browser)).toBe(browser)
  })

  it('rejects unsupported browsers', () => {
    expect(() => resolveE2EBrowser('firefox')).toThrow('Unsupported E2E browser "firefox".')
  })
})
