// @vitest-environment node

import { QueryClient } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({
  connection: vi.fn(async () => undefined),
  getQueryClient: vi.fn(),
  getSystemFeatures: vi.fn(),
  queryKey: [['console', 'systemFeatures', 'get'], { type: 'query' }] as const,
}))

vi.mock('server-only', () => ({}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()

  return {
    ...actual,
    cache: (factory: () => unknown) => {
      let initialized = false
      let value: unknown

      return () => {
        if (!initialized) {
          value = factory()
          initialized = true
        }

        return value
      }
    },
  }
})

vi.mock('@/app/get-query-client', () => ({
  getQueryClient: mocks.getQueryClient,
}))

vi.mock('@/next/server', () => ({
  connection: mocks.connection,
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    systemFeatures: {
      get: {
        queryOptions: (options?: { staleTime?: 'static' }) => ({
          queryKey: mocks.queryKey,
          queryFn: mocks.getSystemFeatures,
          retry: false,
          ...options,
        }),
      },
    },
  },
}))

describe('System Features server requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.getQueryClient.mockImplementation(
      () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    )
    mocks.connection.mockResolvedValue(undefined)
    mocks.getSystemFeatures.mockResolvedValue({ deployment_edition: 'CLOUD' })
  })

  it('reuses a successful optional lookup for the rest of the request', async () => {
    const { dehydrateSystemFeatures, getOptionalSystemFeatures } = await import('../server')

    await expect(getOptionalSystemFeatures()).resolves.toEqual({ deployment_edition: 'CLOUD' })
    await expect(getOptionalSystemFeatures()).resolves.toEqual({ deployment_edition: 'CLOUD' })

    expect(mocks.getSystemFeatures).toHaveBeenCalledOnce()
    expect(mocks.getQueryClient).toHaveBeenCalledOnce()
    expect(dehydrateSystemFeatures().queries).toEqual([
      expect.objectContaining({
        queryKey: mocks.queryKey,
        state: expect.objectContaining({
          data: { deployment_edition: 'CLOUD' },
          status: 'success',
        }),
      }),
    ])
  })

  it('keeps optional failures soft for the rest of the request', async () => {
    mocks.getSystemFeatures.mockRejectedValueOnce(new Error('System Features unavailable'))
    const { getOptionalSystemFeatures } = await import('../server')

    await expect(getOptionalSystemFeatures()).resolves.toBeUndefined()
    await expect(getOptionalSystemFeatures()).resolves.toBeUndefined()

    expect(mocks.getSystemFeatures).toHaveBeenCalledOnce()
  })
})
