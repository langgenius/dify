import type { DifyWorld } from '../features/support/world'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireAgentBackendRuntime } from '../features/agent-v2/support/fixtures/agent-backend'

describe('requireAgentBackendRuntime', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('keeps runtime scenarios runnable when the Go shellctl health endpoint is available', async () => {
    vi.stubEnv('E2E_AGENT_BACKEND_URL', 'http://agent-backend.test/')
    vi.stubEnv('E2E_SHELLCTL_URL', 'http://shellctl.test/')
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = input.toString()
      if (
        url === 'http://agent-backend.test/openapi.json' ||
        url === 'http://shellctl.test/healthz'
      ) {
        return new Response()
      }

      return new Response(null, { status: 404, statusText: 'Not Found' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const attach = vi.fn()
    const world = { attach } as unknown as DifyWorld

    await expect(requireAgentBackendRuntime(world)).resolves.toBe('http://agent-backend.test')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(attach).not.toHaveBeenCalled()
  })
})
