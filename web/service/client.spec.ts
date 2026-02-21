import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loadGetBaseURL = async (isClientValue: boolean) => {
  vi.resetModules()
  vi.doMock('@/utils/client', () => ({ isClient: isClientValue, isServer: !isClientValue }))
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  // eslint-disable-next-line next/no-assign-module-variable
  const module = await import('./client')
  warnSpy.mockClear()
  return { getBaseURL: module.getBaseURL, warnSpy }
}

// Scenario: base URL selection and warnings.
describe('getBaseURL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Scenario: client environment uses window origin.
  it('should use window origin when running on the client', async () => {
    // Arrange
    const { origin } = window.location
    const { getBaseURL, warnSpy } = await loadGetBaseURL(true)

    // Act
    const url = getBaseURL('/api')

    // Assert
    expect(url.href).toBe(`${origin}/api`)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  // Scenario: server environment falls back to localhost with warning.
  it('should fall back to localhost and warn on the server', async () => {
    // Arrange
    const { getBaseURL, warnSpy } = await loadGetBaseURL(false)

    // Act
    const url = getBaseURL('/api')

    // Assert
    expect(url.href).toBe('http://localhost/api')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('Using localhost as base URL in server environment, please configure accordingly.')
  })

  // Scenario: non-http protocols surface warnings.
  it('should warn when protocol is not http or https', async () => {
    // Arrange
    const { getBaseURL, warnSpy } = await loadGetBaseURL(true)

    // Act
    const url = getBaseURL('localhost:5001/console/api')

    // Assert
    expect(url.protocol).toBe('localhost:')
    expect(url.href).toBe('localhost:5001/console/api')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      'Unexpected protocol for API requests, expected http or https. Current protocol: localhost:. Please configure accordingly.',
    )
  })

  // Scenario: absolute http URLs are preserved.
  it('should keep absolute http URLs intact', async () => {
    // Arrange
    const { getBaseURL, warnSpy } = await loadGetBaseURL(true)

    // Act
    const url = getBaseURL('https://api.example.com/console/api')

    // Assert
    expect(url.href).toBe('https://api.example.com/console/api')
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
