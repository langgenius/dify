import type {
  DeploymentEdition,
  GetSystemFeaturesResponse,
} from '@dify/contracts/api/console/system-features/types.gen'
import { zGetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/zod.gen'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { defaultSystemFeatures } from '../config'

const queryKey = ['console', 'systemFeatures'] as const
const queryContext = {
  queryKey,
  signal: new AbortController().signal,
  meta: undefined,
} as never

const createSystemFeatures = (deploymentEdition: DeploymentEdition): GetSystemFeaturesResponse => ({
  ...defaultSystemFeatures,
  deployment_edition: deploymentEdition,
})

describe('System Features contract', () => {
  it('requires a valid deployment edition', () => {
    const { deployment_edition: _, ...missingDeploymentEdition } = createSystemFeatures('CLOUD')

    expect(zGetSystemFeaturesResponse.safeParse(missingDeploymentEdition).success).toBe(false)
    expect(
      zGetSystemFeaturesResponse.safeParse({
        ...createSystemFeatures('CLOUD'),
        deployment_edition: null,
      }).success,
    ).toBe(false)
  })
})

const loadClientModule = async ({
  result,
  error,
}: {
  result?: GetSystemFeaturesResponse
  error?: Error
}) => {
  vi.resetModules()

  const getSystemFeatures = error
    ? vi.fn().mockRejectedValue(error)
    : vi.fn().mockResolvedValue(result)

  vi.doMock('@/service/client', () => ({
    consoleClient: {
      systemFeatures: {
        get: getSystemFeatures,
      },
    },
    consoleQuery: {
      systemFeatures: {
        get: {
          queryKey: () => queryKey,
        },
      },
    },
  }))

  return {
    getSystemFeatures,
    module: await import('../client'),
  }
}

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

describe('systemFeaturesQueryOptions', () => {
  it.each<DeploymentEdition>(['COMMUNITY', 'ENTERPRISE', 'CLOUD'])(
    'fetches backend System Features for %s',
    async (deploymentEdition) => {
      const result = createSystemFeatures(deploymentEdition)
      const { getSystemFeatures, module } = await loadClientModule({ result })

      const data = await module.systemFeaturesQueryOptions().queryFn?.(queryContext)

      expect(getSystemFeatures).toHaveBeenCalledTimes(1)
      expect(data).toBe(result)
    },
  )

  it('uses null deployment edition when the request fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getSystemFeatures, module } = await loadClientModule({
      error: new Error('network failed'),
    })

    const data = await module.systemFeaturesQueryOptions().queryFn?.(queryContext)

    expect(getSystemFeatures).toHaveBeenCalledTimes(1)
    expect(data).toEqual(defaultSystemFeatures)
    expect(data?.deployment_edition).toBeNull()
    errorSpy.mockRestore()
  })
})

describe('serverSystemFeaturesQueryOptions', () => {
  it.each<DeploymentEdition>(['COMMUNITY', 'ENTERPRISE', 'CLOUD'])(
    'fetches backend System Features for %s',
    async (deploymentEdition) => {
      const result = createSystemFeatures(deploymentEdition)
      const { getServerConsoleClientContext, getSystemFeatures, module } = await loadServerModule({
        result,
      })

      const data = await module.serverSystemFeaturesQueryOptions().queryFn?.(queryContext)

      expect(getServerConsoleClientContext).toHaveBeenCalledTimes(1)
      expect(getSystemFeatures).toHaveBeenCalledWith(undefined, {
        context: { cookie: 'session=1' },
      })
      expect(data).toBe(result)
    },
  )

  it('uses null deployment edition when the server request fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getSystemFeatures, module } = await loadServerModule({
      error: new Error('server failed'),
    })

    const data = await module.serverSystemFeaturesQueryOptions().queryFn?.(queryContext)

    expect(getSystemFeatures).toHaveBeenCalledTimes(1)
    expect(data).toEqual(defaultSystemFeatures)
    expect(data?.deployment_edition).toBeNull()
    errorSpy.mockRestore()
  })

  it('dehydrates only the System Features query for the root boundary', async () => {
    const result = createSystemFeatures('CLOUD')
    const { module } = await loadServerModule({ result })
    const queryClient = new QueryClient()

    queryClient.setQueryData(queryKey, result)
    queryClient.setQueryData(['unrelated'], { value: true })

    const state = module.dehydrateSystemFeatures(queryClient)

    expect(state.queries).toHaveLength(1)
    expect(state.queries[0]?.queryKey).toEqual(queryKey)
  })
})
