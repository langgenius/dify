// @vitest-environment node

import { QueryClient } from '@tanstack/react-query'

let queryClient: QueryClient

const mocks = vi.hoisted(() => ({
  connection: vi.fn(async () => undefined),
  getSystemFeatures: vi.fn(),
  queryKey: [['console', 'systemFeatures', 'get'], { type: 'query' }] as const,
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
          queryKey: mocks.queryKey,
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
    vi.resetModules()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.connection.mockResolvedValue(undefined)
    mocks.getSystemFeatures.mockResolvedValue({ deployment_edition: 'CLOUD' })
  })

  it('exposes only domain-level server operations', async () => {
    const server = await import('../server')

    expect(Object.keys(server).sort()).toEqual([
      'dehydrateSystemFeatures',
      'getOptionalSystemFeatures',
      'getSystemFeatures',
    ])
  })

  it.each(['optional', 'required'] as const)(
    'waits for the request boundary before the %s query starts',
    async (operation) => {
      let establishConnection!: () => void
      mocks.connection.mockImplementation(
        () =>
          new Promise<undefined>((resolve) => {
            establishConnection = () => resolve(undefined)
          }),
      )
      const { getOptionalSystemFeatures, getSystemFeatures } = await import('../server')

      const result = operation === 'optional' ? getOptionalSystemFeatures() : getSystemFeatures()
      await Promise.resolve()

      expect(mocks.getSystemFeatures).not.toHaveBeenCalled()

      establishConnection()
      await expect(result).resolves.toEqual({ deployment_edition: 'CLOUD' })
      expect(mocks.getSystemFeatures).toHaveBeenCalledOnce()
    },
  )

  it('uses the same query key as client consumers', async () => {
    const { systemFeaturesQueryOptions } = await import('../client')
    const { getOptionalSystemFeatures } = await import('../server')

    await getOptionalSystemFeatures()

    expect(queryClient.getQueryCache().getAll()[0]?.queryKey).toEqual(
      systemFeaturesQueryOptions().queryKey,
    )
  })

  it('reuses a successful optional lookup for the rest of the request', async () => {
    const { getOptionalSystemFeatures } = await import('../server')

    await expect(getOptionalSystemFeatures()).resolves.toEqual({ deployment_edition: 'CLOUD' })
    await expect(getOptionalSystemFeatures()).resolves.toEqual({ deployment_edition: 'CLOUD' })

    expect(mocks.getSystemFeatures).toHaveBeenCalledOnce()
  })

  it('keeps optional failures soft without repeating the failed request', async () => {
    mocks.getSystemFeatures.mockRejectedValue(new Error('System Features unavailable'))
    const { getOptionalSystemFeatures } = await import('../server')

    await expect(getOptionalSystemFeatures()).resolves.toBeUndefined()
    await expect(getOptionalSystemFeatures()).resolves.toBeUndefined()

    expect(mocks.getSystemFeatures).toHaveBeenCalledOnce()
    expect(queryClient.getQueryData(mocks.queryKey)).toBeUndefined()
  })

  it('does not dehydrate an optional failure', async () => {
    mocks.getSystemFeatures.mockRejectedValue(new Error('System Features unavailable'))
    const { dehydrateSystemFeatures, getOptionalSystemFeatures } = await import('../server')

    await getOptionalSystemFeatures()

    expect(dehydrateSystemFeatures().queries).toEqual([])
  })

  it('allows a required lookup to retry after an optional failure', async () => {
    mocks.getSystemFeatures
      .mockRejectedValueOnce(new Error('System Features unavailable'))
      .mockResolvedValueOnce({ deployment_edition: 'CLOUD' })
    const { getOptionalSystemFeatures, getSystemFeatures } = await import('../server')

    await expect(getOptionalSystemFeatures()).resolves.toBeUndefined()
    await expect(getSystemFeatures()).resolves.toEqual({ deployment_edition: 'CLOUD' })

    expect(mocks.getSystemFeatures).toHaveBeenCalledTimes(2)
  })

  it('preserves required failures for hard route gates', async () => {
    const error = new Error('System Features unavailable')
    mocks.getSystemFeatures.mockRejectedValue(error)
    const { getSystemFeatures } = await import('../server')

    await expect(getSystemFeatures()).rejects.toBe(error)
  })

  it('dehydrates the successful request-local query', async () => {
    const { dehydrateSystemFeatures, getOptionalSystemFeatures } = await import('../server')

    await getOptionalSystemFeatures()

    expect(dehydrateSystemFeatures()).toMatchObject({
      queries: [
        {
          queryKey: mocks.queryKey,
          state: {
            data: { deployment_edition: 'CLOUD' },
            status: 'success',
          },
        },
      ],
    })
  })
})
