import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { getAgentBackendEnvironment } from '../scripts/setup'

describe('managed runtime environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses separate host and Sandbox API addresses', async () => {
    vi.stubEnv('DIFY_AGENT_INNER_API_URL', '')
    vi.stubEnv('DIFY_AGENT_SANDBOX_FILES_BASE_URL', '')

    await expect(getAgentBackendEnvironment()).resolves.toMatchObject({
      DIFY_AGENT_INNER_API_URL: 'http://127.0.0.1:5001',
      DIFY_AGENT_SANDBOX_FILES_BASE_URL: 'http://host.docker.internal:5001',
    })
  })

  it('preserves an explicit Sandbox-reachable API address', async () => {
    vi.stubEnv('DIFY_AGENT_SANDBOX_FILES_BASE_URL', 'https://dify.example.test/base')

    await expect(getAgentBackendEnvironment()).resolves.toMatchObject({
      DIFY_AGENT_SANDBOX_FILES_BASE_URL: 'https://dify.example.test/base',
    })
  })
})
