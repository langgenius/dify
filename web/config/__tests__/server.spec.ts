// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const importServerConfig = async () => {
  vi.resetModules()
  return import('../server')
}

describe('server config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('should prefer the server-only console API URL for server requests', async () => {
    vi.stubEnv('SERVER_CONSOLE_API_URL', 'http://api:5001')
    vi.stubEnv('CONSOLE_API_URL', 'https://console.example.com')

    const { SERVER_CONSOLE_API_PREFIX } = await importServerConfig()

    expect(SERVER_CONSOLE_API_PREFIX).toBe('http://api:5001/console/api')
  })

  it('should fall back to the public console API URL when no server-only URL is configured', async () => {
    vi.stubEnv('SERVER_CONSOLE_API_URL', '')
    vi.stubEnv('CONSOLE_API_URL', 'https://console.example.com')

    const { SERVER_CONSOLE_API_PREFIX } = await importServerConfig()

    expect(SERVER_CONSOLE_API_PREFIX).toBe('https://console.example.com/console/api')
  })

  it('should remain unconfigured when both server URLs are empty', async () => {
    vi.stubEnv('SERVER_CONSOLE_API_URL', '')
    vi.stubEnv('CONSOLE_API_URL', '')

    const { SERVER_CONSOLE_API_PREFIX } = await importServerConfig()

    expect(SERVER_CONSOLE_API_PREFIX).toBeUndefined()
  })
})
