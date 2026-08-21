// @vitest-environment node

import { QueryClient } from '@tanstack/react-query'

let queryClient: QueryClient

const mocks = vi.hoisted(() => ({
  connection: vi.fn(async () => undefined),
  getSystemFeatures: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/app/get-query-client', () => ({
  getQueryClient: () => queryClient,
}))

vi.mock('@/next/server', () => ({
  connection: mocks.connection,
}))

vi.mock('@/service/server', () => ({
  serverConsoleQuery: {
    systemFeatures: {
      get: {
        queryOptions: () => ({
          queryKey: ['console', 'system-features'],
          queryFn: mocks.getSystemFeatures,
          retry: false,
        }),
      },
    },
  },
}))

describe('System Features server requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.connection.mockResolvedValue(undefined)
    mocks.getSystemFeatures.mockResolvedValue({ deployment_edition: 'CLOUD' })
  })

  it.each(['prefetch', 'ensure'] as const)(
    'waits for the request boundary before the %s query starts',
    async (operation) => {
      let establishConnection!: () => void
      mocks.connection.mockImplementation(
        () =>
          new Promise<undefined>((resolve) => {
            establishConnection = () => resolve(undefined)
          }),
      )
      const { ensureSystemFeatures, prefetchSystemFeatures } = await import('../server')

      const result = operation === 'prefetch' ? prefetchSystemFeatures() : ensureSystemFeatures()
      await Promise.resolve()

      expect(mocks.getSystemFeatures).not.toHaveBeenCalled()

      establishConnection()
      await expect(result).resolves.toEqual({ deployment_edition: 'CLOUD' })
      expect(mocks.getSystemFeatures).toHaveBeenCalledOnce()
      expect(queryClient.getQueryData(['console', 'system-features'])).toEqual({
        deployment_edition: 'CLOUD',
      })
    },
  )

  it('keeps prefetch failures soft', async () => {
    mocks.getSystemFeatures.mockRejectedValue(new Error('System Features unavailable'))
    const { prefetchSystemFeatures } = await import('../server')

    await expect(prefetchSystemFeatures()).resolves.toBeUndefined()
    expect(queryClient.getQueryData(['console', 'system-features'])).toBeUndefined()
  })

  it('preserves ensure failures for hard route gates', async () => {
    const error = new Error('System Features unavailable')
    mocks.getSystemFeatures.mockRejectedValue(error)
    const { ensureSystemFeatures } = await import('../server')

    await expect(ensureSystemFeatures()).rejects.toBe(error)
  })
})
