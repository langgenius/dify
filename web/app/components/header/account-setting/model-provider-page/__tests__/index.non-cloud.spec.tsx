import { screen } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import {
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  QuotaUnitEnum,
} from '../declarations'
import ModelProviderPage from '../index'

const mockQuotaConfig = {
  quota_type: CurrentSystemQuotaTypeEnum.free,
  quota_unit: QuotaUnitEnum.times,
  quota_limit: 100,
  quota_used: 1,
  last_used: 0,
  is_valid: true,
}

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    IS_CLOUD_EDITION: false,
  }
})

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    modelProviders: [{
      provider: 'openai',
      label: { en_US: 'OpenAI' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    }],
  }),
}))

vi.mock('../hooks', () => ({
  useDefaultModel: () => ({ data: null, isLoading: false }),
}))

vi.mock('../provider-added-card', () => ({
  default: () => <div data-testid="provider-card" />,
}))

vi.mock('../provider-added-card/quota-panel', () => ({
  default: () => <div data-testid="quota-panel" />,
}))

vi.mock('../system-model-selector', () => ({
  default: () => <div data-testid="system-model-selector" />,
}))

vi.mock('../install-from-marketplace', () => ({
  default: () => <div data-testid="install-from-marketplace" />,
}))

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  const originalPlugins = actual.consoleQuery.plugins as unknown as Record<string, unknown>
  return {
    ...actual,
    consoleQuery: new Proxy(actual.consoleQuery, {
      get(target, prop) {
        if (prop === 'plugins') {
          return {
            ...originalPlugins,
            checkInstalled: {
              queryOptions: () => ({
                queryKey: ['plugins', 'checkInstalled'],
                queryFn: () => new Promise(() => {}),
              }),
            },
            latestVersions: {
              queryOptions: () => ({
                queryKey: ['plugins', 'latestVersions'],
                queryFn: () => new Promise(() => {}),
              }),
            },
          }
        }
        return Reflect.get(target, prop)
      },
    }),
  }
})

describe('ModelProviderPage non-cloud branch', () => {
  it('should skip the quota panel when cloud edition is disabled', () => {
    renderWithSystemFeatures(<ModelProviderPage searchText="" />, {
      systemFeatures: { enable_marketplace: false },
    })

    expect(screen.getByTestId('system-model-selector')).toBeInTheDocument()
    expect(screen.queryByTestId('quota-panel')).not.toBeInTheDocument()
  })
})
