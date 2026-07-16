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
    modelProviders: [
      {
        provider: 'openai',
        label: { en_US: 'OpenAI' },
        custom_configuration: { status: CustomConfigurationStatusEnum.active },
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.free,
          quota_configurations: [mockQuotaConfig],
        },
      },
    ],
  }),
}))

vi.mock('../hooks', () => ({
  useDefaultModel: () => ({ data: null, isLoading: false }),
  useLanguage: () => 'en_US',
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

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  useCanSetPluginSettings: () => ({
    canSetPermissions: true,
    canSetPluginPreferences: true,
  }),
  usePluginSettingsAccess: () => ({
    canSetPermissions: true,
    canSetPluginPreferences: true,
  }),
  default: () => ({
    referenceSetting: {
      permission: {},
      auto_upgrade: {
        strategy_setting: 'latest',
        upgrade_time_of_day: 0,
        upgrade_mode: 'all',
        exclude_plugins: [],
        include_plugins: [],
      },
    },
    setReferenceSettings: vi.fn(),
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => ({
    data: { plugins: [] },
  }),
  useInvalidateInstalledPluginList: () => vi.fn(),
  useInvalidateCheckInstalled: () => vi.fn(),
  usePluginAutoUpgradeSettings: () => ({
    data: {
      category: 'model',
      auto_upgrade: {
        strategy_setting: 'latest',
        upgrade_time_of_day: 0,
        upgrade_mode: 'all',
        exclude_plugins: [],
        include_plugins: [],
      },
    },
    error: undefined,
    isFetching: false,
    isLoading: false,
  }),
  useMutationPluginAutoUpgradeSettings: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/app/components/plugins/reference-setting-modal', () => ({
  default: () => <div data-testid="reference-setting-modal" />,
}))

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  const originalWorkspaces = actual.consoleQuery.workspaces
  return {
    ...actual,
    consoleQuery: new Proxy(actual.consoleQuery, {
      get(target, prop) {
        if (prop === 'workspaces') {
          return {
            ...originalWorkspaces,
            current: {
              ...originalWorkspaces.current,
              plugin: {
                ...originalWorkspaces.current.plugin,
                list: {
                  ...originalWorkspaces.current.plugin.list,
                  installations: {
                    ids: {
                      post: {
                        queryOptions: () => ({
                          queryKey: [
                            'workspaces',
                            'current',
                            'plugin',
                            'list',
                            'installations',
                            'ids',
                            'post',
                          ],
                          queryFn: () => new Promise(() => {}),
                        }),
                      },
                    },
                  },
                  latestVersions: {
                    post: {
                      queryOptions: () => ({
                        queryKey: [
                          'workspaces',
                          'current',
                          'plugin',
                          'list',
                          'latestVersions',
                          'post',
                        ],
                        queryFn: () => new Promise(() => {}),
                      }),
                    },
                  },
                },
              },
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
