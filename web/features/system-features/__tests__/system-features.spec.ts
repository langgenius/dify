import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import { describe, expect, it, vi } from 'vitest'
import { defaultSystemFeatures } from '../config'

type LoadOptions = {
  cloudEnv?: Partial<typeof defaultCloudEnv>
  isCloudEdition: boolean
  systemFeaturesResult?: GetSystemFeaturesResponse
  systemFeaturesError?: Error
}

const defaultCloudEnv = {
  NEXT_PUBLIC_ALLOW_CREATE_WORKSPACE: true,
  NEXT_PUBLIC_ALLOW_REGISTER: true,
  NEXT_PUBLIC_CREATORS_PLATFORM_FEATURES_ENABLED: true,
  NEXT_PUBLIC_ENABLE_CHANGE_EMAIL: true,
  NEXT_PUBLIC_ENABLE_COLLABORATION_MODE: false,
  NEXT_PUBLIC_ENABLE_EMAIL_CODE_LOGIN: true,
  NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD_LOGIN: false,
  NEXT_PUBLIC_ENABLE_EXPLORE_BANNER: true,
  NEXT_PUBLIC_ENABLE_MARKETPLACE: true,
  NEXT_PUBLIC_ENABLE_SOCIAL_OAUTH_LOGIN: true,
  NEXT_PUBLIC_ENABLE_TRIAL_APP: true,
  NEXT_PUBLIC_IS_EMAIL_SETUP: true,
  NEXT_PUBLIC_RBAC_ENABLED: false,
}

const queryKey = ['console', 'systemFeatures'] as const
const queryContext = {
  queryKey,
  signal: new AbortController().signal,
  meta: undefined,
} as never

const loadSystemFeaturesModule = async ({
  cloudEnv,
  isCloudEdition,
  systemFeaturesResult = defaultSystemFeatures,
  systemFeaturesError,
}: LoadOptions) => {
  vi.resetModules()

  const systemFeatures = systemFeaturesError
    ? vi.fn().mockRejectedValue(systemFeaturesError)
    : vi.fn().mockResolvedValue(systemFeaturesResult)

  vi.doMock('@/config', () => ({
    IS_CLOUD_EDITION: isCloudEdition,
  }))
  vi.doMock('@/env', () => ({
    env: {
      ...defaultCloudEnv,
      ...cloudEnv,
    },
  }))
  vi.doMock('@/service/client', () => ({
    consoleClient: {
      systemFeatures: {
        get: systemFeatures,
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

  const module = await import('../client')

  return {
    module,
    systemFeatures,
  }
}

const loadServerSystemFeaturesModule = async ({
  cloudEnv,
  isCloudEdition,
  systemFeaturesResult = defaultSystemFeatures,
  systemFeaturesError,
}: LoadOptions) => {
  vi.resetModules()

  const getServerConsoleClientContext = vi.fn().mockResolvedValue({ cookie: 'session=1' })
  const systemFeatures = systemFeaturesError
    ? vi.fn().mockRejectedValue(systemFeaturesError)
    : vi.fn().mockResolvedValue(systemFeaturesResult)

  vi.doMock('@/config', () => ({
    IS_CLOUD_EDITION: isCloudEdition,
  }))
  vi.doMock('@/env', () => ({
    env: {
      ...defaultCloudEnv,
      ...cloudEnv,
    },
  }))
  vi.doMock('@/service/server', () => ({
    getServerConsoleClientContext,
    serverConsoleClient: {
      systemFeatures: {
        get: systemFeatures,
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

  const module = await import('../server')

  return {
    getServerConsoleClientContext,
    module,
    systemFeatures,
  }
}

describe('systemFeaturesQueryOptions', () => {
  it('should return Cloud defaults without calling system-features when Cloud edition is enabled', async () => {
    const { module, systemFeatures } = await loadSystemFeaturesModule({
      isCloudEdition: true,
    })

    const options = module.systemFeaturesQueryOptions()
    const data = await options.queryFn?.(queryContext)

    expect(systemFeatures).not.toHaveBeenCalled()
    expect(options.staleTime).toBe('static')
    expect(data).toMatchObject({
      enable_marketplace: true,
      enable_email_code_login: true,
      enable_email_password_login: false,
      enable_social_oauth_login: true,
      enable_trial_app: true,
      rbac_enabled: false,
    })
  })

  it('should use Cloud environment flags with local defaults for fixed fields', async () => {
    const { module } = await loadSystemFeaturesModule({
      isCloudEdition: true,
      cloudEnv: {
        NEXT_PUBLIC_ENABLE_MARKETPLACE: false,
        NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD_LOGIN: true,
        NEXT_PUBLIC_ENABLE_COLLABORATION_MODE: true,
        NEXT_PUBLIC_ALLOW_REGISTER: false,
        NEXT_PUBLIC_ENABLE_EXPLORE_BANNER: false,
        NEXT_PUBLIC_RBAC_ENABLED: true,
      },
    })

    const options = module.systemFeaturesQueryOptions()
    const data = await options.queryFn?.(queryContext)

    expect(data).toMatchObject({
      enable_marketplace: false,
      enable_email_password_login: true,
      enable_collaboration_mode: true,
      is_allow_register: false,
      enable_explore_banner: false,
      rbac_enabled: true,
      branding: {
        enabled: false,
        application_title: '',
        favicon: '',
      },
      license: {
        status: 'none',
      },
    })
  })

  it('should fetch system-features when Cloud edition is disabled', async () => {
    const systemFeaturesResult = {
      ...defaultSystemFeatures,
      enable_marketplace: true,
    }
    const { module, systemFeatures } = await loadSystemFeaturesModule({
      isCloudEdition: false,
      systemFeaturesResult,
    })

    const options = module.systemFeaturesQueryOptions()
    const data = await options.queryFn?.(queryContext)

    expect(systemFeatures).toHaveBeenCalledTimes(1)
    expect(data).toBe(systemFeaturesResult)
  })

  it('should fall back to defaults when the non-Cloud request fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { module, systemFeatures } = await loadSystemFeaturesModule({
      isCloudEdition: false,
      systemFeaturesError: new Error('network failed'),
    })

    const options = module.systemFeaturesQueryOptions()
    const data = await options.queryFn?.(queryContext)

    expect(systemFeatures).toHaveBeenCalledTimes(1)
    expect(data).toEqual(defaultSystemFeatures)

    errorSpy.mockRestore()
  })
})

describe('serverSystemFeaturesQueryOptions', () => {
  it('should prefetch Cloud defaults without calling server system-features when Cloud edition is enabled', async () => {
    const { getServerConsoleClientContext, module, systemFeatures } = await loadServerSystemFeaturesModule({
      isCloudEdition: true,
      cloudEnv: {
        NEXT_PUBLIC_ENABLE_MARKETPLACE: false,
        NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD_LOGIN: true,
      },
    })

    const options = module.serverSystemFeaturesQueryOptions()
    const data = await options.queryFn?.(queryContext)

    expect(getServerConsoleClientContext).not.toHaveBeenCalled()
    expect(systemFeatures).not.toHaveBeenCalled()
    expect(options.staleTime).toBe('static')
    expect(data).toMatchObject({
      enable_marketplace: false,
      enable_email_password_login: true,
    })
  })

  it('should fetch server system-features when Cloud edition is disabled', async () => {
    const systemFeaturesResult = {
      ...defaultSystemFeatures,
      enable_marketplace: true,
    }
    const { getServerConsoleClientContext, module, systemFeatures } = await loadServerSystemFeaturesModule({
      isCloudEdition: false,
      systemFeaturesResult,
    })

    const options = module.serverSystemFeaturesQueryOptions()
    const data = await options.queryFn?.(queryContext)

    expect(getServerConsoleClientContext).toHaveBeenCalledTimes(1)
    expect(systemFeatures).toHaveBeenCalledTimes(1)
    expect(systemFeatures).toHaveBeenCalledWith(undefined, {
      context: { cookie: 'session=1' },
    })
    expect(data).toBe(systemFeaturesResult)
  })

  it('should fall back to defaults when the non-Cloud server request fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { module, systemFeatures } = await loadServerSystemFeaturesModule({
      isCloudEdition: false,
      systemFeaturesError: new Error('server failed'),
    })

    const options = module.serverSystemFeaturesQueryOptions()
    const data = await options.queryFn?.(queryContext)

    expect(systemFeatures).toHaveBeenCalledTimes(1)
    expect(data).toEqual(defaultSystemFeatures)

    errorSpy.mockRestore()
  })
})
