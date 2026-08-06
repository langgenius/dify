// @vitest-environment node

import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isServer: true,
  getQueryClientServer: vi.fn(),
  makeQueryClient: vi.fn(),
}))

vi.mock('@/utils/client', () => ({
  get isServer() {
    return mocks.isServer
  },
  isClient: false,
}))

vi.mock('../query-client-server', () => ({
  get getQueryClientServer() {
    return mocks.getQueryClientServer
  },
  get makeQueryClient() {
    return mocks.makeQueryClient
  },
}))

describe('TanStackQueryProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.isServer = true
    mocks.getQueryClientServer.mockReturnValue({})
    mocks.makeQueryClient.mockReturnValue({})
  })

  it('reuses the request-scoped server query client during SSR', async () => {
    const { TanStackQueryProvider } = await import('../query-client')

    renderToString(
      <TanStackQueryProvider>
        <div>child</div>
      </TanStackQueryProvider>,
    )

    expect(mocks.getQueryClientServer).toHaveBeenCalled()
    expect(mocks.makeQueryClient).not.toHaveBeenCalled()
  })
})
