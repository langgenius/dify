// @vitest-environment node

import { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

const mocks = vi.hoisted(() => ({
  connection: vi.fn(async () => undefined),
  getQueryClient: vi.fn(),
  getSystemFeatures: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/app/get-query-client', () => ({
  getQueryClient: mocks.getQueryClient,
}))

vi.mock('@/next/server', () => ({
  connection: mocks.connection,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'systemFeatures.get': () => mocks.getSystemFeatures(),
    }),
  }
})

describe('System Features server requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.getQueryClient.mockReturnValue(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    )
    mocks.connection.mockResolvedValue(undefined)
    mocks.getSystemFeatures.mockResolvedValue({ deployment_edition: 'CLOUD' })
  })

  it('reuses a successful optional lookup from the request query client', async () => {
    const { dehydrateSystemFeatures, getOptionalSystemFeatures } = await import('../server')

    await expect(getOptionalSystemFeatures()).resolves.toEqual({ deployment_edition: 'CLOUD' })
    await expect(getOptionalSystemFeatures()).resolves.toEqual({ deployment_edition: 'CLOUD' })

    expect(mocks.getSystemFeatures).toHaveBeenCalledOnce()
    expect(dehydrateSystemFeatures().queries).toEqual([
      expect.objectContaining({
        queryKey: consoleQuery.systemFeatures.get.queryKey(),
        state: expect.objectContaining({
          data: { deployment_edition: 'CLOUD' },
          status: 'success',
        }),
      }),
    ])
  })

  it('keeps optional failures soft and lets required consumers retry', async () => {
    mocks.getSystemFeatures
      .mockRejectedValueOnce(new Error('System Features unavailable'))
      .mockResolvedValueOnce({ deployment_edition: 'CLOUD' })
    const { getOptionalSystemFeatures, getSystemFeatures } = await import('../server')

    await expect(getOptionalSystemFeatures()).resolves.toBeUndefined()
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
})
