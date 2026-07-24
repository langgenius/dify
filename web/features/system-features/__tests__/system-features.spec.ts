import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { createSystemFeaturesFixture } from '@/test/console/system-features'

const queryKey = ['console', 'systemFeatures'] as const
const queryContext = {
  queryKey,
  signal: new AbortController().signal,
  meta: undefined,
} as never

const loadServerModule = async ({
  result,
  error,
}: {
  result?: GetSystemFeaturesResponse
  error?: Error
}) => {
  vi.resetModules()

  const getServerConsoleClientContext = vi.fn().mockResolvedValue({ cookie: 'session=1' })
  const getSystemFeatures = error
    ? vi.fn().mockRejectedValue(error)
    : vi.fn().mockResolvedValue(result)

  vi.doMock('@/service/server', () => ({
    getServerConsoleClientContext,
    serverConsoleClient: {
      systemFeatures: {
        get: getSystemFeatures,
      },
    },
    serverConsoleQuery: {
      systemFeatures: {
        get: {
          queryKey: () => queryKey,
        },
      },
    },
  }))

  return {
    getServerConsoleClientContext,
    getSystemFeatures,
    module: await import('../server'),
  }
}

describe('serverSystemFeaturesQueryOptions', () => {
  it('fetches System Features with the server request context', async () => {
    const result = createSystemFeaturesFixture({ deployment_edition: 'ENTERPRISE' })
    const { getServerConsoleClientContext, getSystemFeatures, module } = await loadServerModule({
      result,
    })

    const data = await module.serverSystemFeaturesQueryOptions().queryFn?.(queryContext)

    expect(getServerConsoleClientContext).toHaveBeenCalledTimes(1)
    expect(getSystemFeatures).toHaveBeenCalledWith(undefined, {
      context: { cookie: 'session=1' },
    })
    expect(data).toBe(result)
  })

  it('preserves server request failures', async () => {
    const error = new Error('server failed')
    const { getSystemFeatures, module } = await loadServerModule({ error })
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    await expect(queryClient.fetchQuery(module.serverSystemFeaturesQueryOptions())).rejects.toBe(
      error,
    )

    expect(getSystemFeatures).toHaveBeenCalledTimes(1)
  })
})
