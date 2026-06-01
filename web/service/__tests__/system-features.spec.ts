import type { SystemFeatures } from '@/types/feature'
import { describe, expect, it, vi } from 'vitest'
import { defaultSystemFeatures } from '@/types/feature'

type LoadOptions = {
  cloudEnv?: Partial<typeof defaultCloudEnv>
  isCloudEdition: boolean
  systemFeaturesResult?: SystemFeatures
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
  vi.doMock('../client', () => ({
    consoleClient: {
      systemFeatures,
    },
    consoleQuery: {
      systemFeatures: {
        queryKey: () => queryKey,
      },
    },
  }))

  const module = await import('../system-features')

  return {
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
    expect(options.staleTime).toBe(Infinity)
    expect(data).toMatchObject({
      enable_marketplace: true,
      enable_email_code_login: true,
      enable_email_password_login: false,
      enable_social_oauth_login: true,
      enable_trial_app: true,
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
