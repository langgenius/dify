import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDevProxyConfig } from './proxy'

describe('createDevProxyConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Scenario: relative prefixes should be routed through the local dev proxy.
  it('should create both proxies when api prefixes are relative paths', () => {
    // Arrange
    const proxyConfig = createDevProxyConfig({
      consoleApiPrefix: '/console/api',
      publicApiPrefix: '/api',
      consoleApiTarget: 'https://console.example.com',
      publicApiTarget: 'https://public.example.com',
    })

    // Assert
    expect(proxyConfig['/console/api']?.target).toBe('https://console.example.com')
    expect(proxyConfig['/api']?.target).toBe('https://public.example.com')
  })

  // Scenario: absolute console prefix should bypass the local dev proxy.
  it('should skip console proxy when the console api prefix is absolute', () => {
    // Arrange
    const proxyConfig = createDevProxyConfig({
      consoleApiPrefix: 'https://api.example.com/console/api',
      publicApiPrefix: '/api',
      publicApiTarget: 'https://public.example.com',
    })

    // Assert
    expect(proxyConfig).not.toHaveProperty('/console/api')
    expect(proxyConfig['/api']?.target).toBe('https://public.example.com')
  })

  // Scenario: absolute public prefix should bypass the local dev proxy.
  it('should skip public proxy when the public api prefix is absolute', () => {
    // Arrange
    const proxyConfig = createDevProxyConfig({
      consoleApiPrefix: '/console/api',
      publicApiPrefix: 'https://app.example.com/api',
      consoleApiTarget: 'https://console.example.com',
    })

    // Assert
    expect(proxyConfig['/console/api']?.target).toBe('https://console.example.com')
    expect(proxyConfig).not.toHaveProperty('/api')
  })
})
