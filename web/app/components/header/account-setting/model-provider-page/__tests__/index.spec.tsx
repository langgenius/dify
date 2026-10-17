import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ModelTypeEnum } from '../declarations'
import { zDefaultModelResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import {
  getStepByStepTourTargetSelector,
  STEP_BY_STEP_TOUR_TARGETS,
} from '@/app/components/step-by-step-tour/target-registry'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as renderWithConsoleQueryWithoutUrlState,
} from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import {
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  QuotaUnitEnum,
} from '../declarations'
import ModelProviderPage from '../index'

const providerSummaryFixture = {
  provider: 'openai',
  plugin_id: 'langgenius/openai',
  label: { en_US: 'OpenAI' },
  configurate_methods: ['predefined-model'],
  supported_model_types: ['llm'],
  preferred_provider_type: 'custom',
  is_configured: true,
  system_configuration: { enabled: false },
  custom_configuration: {
    status: 'active',
    available_credentials: [],
    current_credential_usable: true,
    has_custom_models: false,
  },
} satisfies ModelProviderSummaryResponse

type MockReferenceSetting = {
  permission: Record<string, never>
  auto_upgrade?: {
    strategy_setting: string
    upgrade_time_of_day: number
    upgrade_mode: string
    exclude_plugins: string[]
    include_plugins: string[]
  }
}

const { mockSaveAutoUpgrade } = vi.hoisted(() => ({
  mockSaveAutoUpgrade: vi.fn(),
}))

const { mockDefaultModelQuery, mockPluginSettingsAccess } = vi.hoisted(() => ({
  mockDefaultModelQuery: vi.fn(),
  mockPluginSettingsAccess: { canSetPluginPreferences: true },
}))

const { mockReferenceSetting, mockAutoUpgradeError } = vi.hoisted(() => ({
  mockReferenceSetting: {
    permission: {},
    auto_upgrade: {
      strategy_setting: 'latest',
      upgrade_time_of_day: 0,
      upgrade_mode: 'all',
      exclude_plugins: [],
      include_plugins: [],
    },
  } as MockReferenceSetting,
  mockAutoUpgradeError: {
    value: undefined as Error | undefined,
  },
}))

const { mockSummaryState } = vi.hoisted(() => ({
  mockSummaryState: {
    isLoading: false,
    plugins: {} as Record<
      string,
      {
        installation_id: string
        plugin_id: string
        plugin_unique_identifier: string
        runtime_type: string
        source: 'github' | 'marketplace' | 'package' | 'remote'
        version: string
      }
    >,
  },
}))

const mockQuotaConfig = {
  quota_type: CurrentSystemQuotaTypeEnum.free,
  quota_unit: QuotaUnitEnum.times,
  quota_limit: 100,
  quota_used: 1,
  last_used: 0,
  is_valid: true,
}

const saveUpdateSettings = () => {
  fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
}

const openUpdateSettings = () => {
  fireEvent.click(screen.getByRole('button', { name: /plugin\.autoUpdate\.autoUpdate/ }))
}

type MockProvider = {
  provider: string
  plugin_id?: string
  label: { en_US: string }
  custom_configuration: { status: CustomConfigurationStatusEnum }
  system_configuration: {
    enabled: boolean
    current_quota_type: CurrentSystemQuotaTypeEnum
    quota_configurations: (typeof mockQuotaConfig)[]
  }
}

const mockProviders: MockProvider[] = [
  {
    provider: 'openai',
    plugin_id: 'langgenius/openai',
    label: { en_US: 'OpenAI' },
    custom_configuration: { status: CustomConfigurationStatusEnum.active },
    system_configuration: {
      enabled: false,
      current_quota_type: CurrentSystemQuotaTypeEnum.free,
      quota_configurations: [mockQuotaConfig],
    },
  },
  {
    provider: 'anthropic',
    plugin_id: 'langgenius/anthropic',
    label: { en_US: 'Anthropic' },
    custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
    system_configuration: {
      enabled: false,
      current_quota_type: CurrentSystemQuotaTypeEnum.free,
      quota_configurations: [mockQuotaConfig],
    },
  },
]

const onUrlUpdate = vi.fn()
const renderWithConsoleQuery = createNuqsTestRenderer(
  renderWithConsoleQueryWithoutUrlState,
  () => ({ onUrlUpdate }),
)

const mockDefaultModels: Record<
  string,
  {
    data: {
      model: string
      model_type: string
      provider: { provider: string; icon_small: { en_US: string } }
    } | null
    isLoading: boolean
  }
> = {
  llm: { data: null, isLoading: false },
  'text-embedding': { data: null, isLoading: false },
  rerank: { data: null, isLoading: false },
  speech2text: { data: null, isLoading: false },
  tts: { data: null, isLoading: false },
}
const renderModelProviderPage = (
  props: {
    enableMarketplace?: boolean
    searchText?: string
    stickyToolbar?: boolean
  } = {},
) => {
  const { searchText = '', enableMarketplace = true, stickyToolbar = true } = props
  const queryClient = createConsoleQueryClient()
  if (mockPluginSettingsAccess.canSetPluginPreferences) {
    for (const [type, state] of Object.entries(mockDefaultModels)) {
      if (!state.isLoading)
        queryClient.setQueryData(
          consoleQuery.workspaces.current.defaultModel.get.queryKey({
            input: { query: { model_type: type as ModelTypeEnum } },
          }),
          {
            data: state.data
              ? zDefaultModelResponse.parse({
                  ...state.data,
                  provider: {
                    label: { en_US: state.data.provider.provider },
                    tenant_id: 'workspace-1',
                    supported_model_types: [state.data.model_type],
                    ...state.data.provider,
                  },
                })
              : null,
          },
        )
    }
  }
  if (mockSummaryState.isLoading) {
    queryClient.setQueryDefaults(
      consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(),
      { queryFn: () => new Promise(() => {}) },
    )
  } else {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(),
      {
        data: mockProviders.map(
          (provider) =>
            ({
              ...providerSummaryFixture,
              ...{
                ...provider,
                is_configured:
                  provider.custom_configuration.status === CustomConfigurationStatusEnum.active ||
                  provider.system_configuration.enabled,
              },
              custom_configuration: {
                ...providerSummaryFixture.custom_configuration,
                ...provider.custom_configuration,
              },
            }) satisfies ModelProviderSummaryResponse,
        ),
        plugins: mockSummaryState.plugins,
      },
    )
  }
  return renderWithConsoleQuery(
    <ModelProviderPage searchText={searchText} stickyToolbar={stickyToolbar} />,
    {
      queryClient,
      systemFeatures: { enable_marketplace: enableMarketplace },
    },
  )
}

vi.mock('../install-from-marketplace', () => ({
  default: () => <div data-testid="install-from-marketplace" />,
}))

vi.mock('../provider-added-card', () => ({
  default: ({
    notConfigured,
    provider,
    pluginSummary,
  }: {
    notConfigured?: boolean
    provider: { provider: string }
    pluginSummary?: { plugin_id: string; source?: string }
  }) => (
    <div
      data-testid="provider-card"
      data-not-configured={String(!!notConfigured)}
      data-plugin-id={pluginSummary?.plugin_id ?? ''}
      data-plugin-source={pluginSummary?.source ?? ''}
    >
      {provider.provider}
    </div>
  ),
}))

vi.mock('../provider-added-card/quota-panel', () => ({
  default: () => <div data-testid="quota-panel" />,
}))

vi.mock('../system-model-selector', () => ({
  default: ({ className, notConfigured }: { className?: string; notConfigured?: boolean }) => (
    <div
      data-testid="system-model-selector"
      data-not-configured={String(notConfigured)}
      className={className}
    />
  ),
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  useCanSetPluginSettings: () => ({
    canSetPermissions: true,
    canSetPluginPreferences: true,
  }),
  usePluginSettingsAccess: () => ({
    canSetPermissions: true,
    canSetPluginPreferences: mockPluginSettingsAccess.canSetPluginPreferences,
  }),
  default: () => ({
    referenceSetting: mockReferenceSetting,
    canSetPermissions: true,
    canSetPluginPreferences: true,
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => ({ data: { plugins: [] }, isLoading: false }),
  usePluginAutoUpgradeSettings: () => ({
    data: mockReferenceSetting.auto_upgrade
      ? {
          category: 'model',
          auto_upgrade: mockReferenceSetting.auto_upgrade,
        }
      : undefined,
    error: mockAutoUpgradeError.value,
    isFetching: false,
    isLoading: !mockReferenceSetting.auto_upgrade && !mockAutoUpgradeError.value,
  }),
  useMutationPluginAutoUpgradeSettings: () => ({
    mutate: mockSaveAutoUpgrade,
    isPending: false,
  }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.summary.get': () => new Promise(() => {}),
      'workspaces.current.defaultModel.get': mockDefaultModelQuery,
      'workspaces.current.plugin.list.latestVersions.post': () => new Promise(() => {}),
    }),
  }
})

describe('ModelProviderPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockDefaultModelQuery.mockImplementation(() => new Promise(() => {}))
    mockSummaryState.isLoading = false
    mockSummaryState.plugins = {}
    mockPluginSettingsAccess.canSetPluginPreferences = true
    mockAutoUpgradeError.value = undefined
    mockReferenceSetting.auto_upgrade = {
      strategy_setting: 'latest',
      upgrade_time_of_day: 0,
      upgrade_mode: 'all',
      exclude_plugins: [],
      include_plugins: [],
    }
    Object.keys(mockDefaultModels).forEach((key) => {
      mockDefaultModels[key] = { data: null, isLoading: false }
    })
    mockProviders.splice(
      0,
      mockProviders.length,
      {
        provider: 'openai',
        plugin_id: 'langgenius/openai',
        label: { en_US: 'OpenAI' },
        custom_configuration: { status: CustomConfigurationStatusEnum.active },
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.free,
          quota_configurations: [mockQuotaConfig],
        },
      },
      {
        provider: 'anthropic',
        plugin_id: 'langgenius/anthropic',
        label: { en_US: 'Anthropic' },
        custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.free,
          quota_configurations: [mockQuotaConfig],
        },
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render main elements', () => {
    renderModelProviderPage()
    expect(
      screen.getByPlaceholderText('modelProvider.modelProvider.searchModels'),
    ).toBeInTheDocument()
    const autoUpdateButton = screen.getByRole('button', { name: /plugin\.autoUpdate\.autoUpdate/ })
    const systemModelSelector = screen.getByTestId('system-model-selector')
    expect(autoUpdateButton).toBeInTheDocument()
    expect(systemModelSelector).toBeInTheDocument()
    expect(screen.getByTestId('install-from-marketplace')).toBeInTheDocument()
  })

  it('should skip system model settings without plugin preference access', () => {
    mockPluginSettingsAccess.canSetPluginPreferences = false

    renderModelProviderPage()

    expect(mockDefaultModelQuery).not.toHaveBeenCalled()
    expect(screen.queryByTestId('system-model-selector')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /plugin\.autoUpdate\.autoUpdate/ }),
    ).not.toBeInTheDocument()
  })

  it('should show the current auto-update strategy on the update setting button', () => {
    renderModelProviderPage()

    expect(screen.getAllByText('plugin.autoUpdate.strategy.latest.name')[0]).toBeInTheDocument()
    openUpdateSettings()
    expect(
      screen.getByRole('radiogroup', { name: 'plugin.autoUpdate.autoUpdate' }),
    ).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.scope')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /plugin\.autoUpdate\.updateTime/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.changeTimezone')).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'plugin.autoUpdate.strategy.fixOnly.name' }),
    ).toBeInTheDocument()
  })

  it('should not expose editable update settings while backend auto-upgrade data is loading', () => {
    mockReferenceSetting.auto_upgrade = undefined

    renderModelProviderPage()

    const updateSettingButton = screen.getByText('plugin.autoUpdate.autoUpdate').closest('button')
    expect(updateSettingButton).not.toBeDisabled()
    expect(screen.queryByText('plugin.autoUpdate.strategy.latest.name')).not.toBeInTheDocument()
    openUpdateSettings()
    expect(screen.getByRole('status')).toHaveTextContent('common.loading')
    expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
    expect(mockSaveAutoUpgrade).not.toHaveBeenCalled()
  })

  it('should render a failure state when backend auto-upgrade data fails', () => {
    mockReferenceSetting.auto_upgrade = undefined
    mockAutoUpgradeError.value = new Error('auto-upgrade failed')

    renderModelProviderPage()

    openUpdateSettings()
    expect(screen.getByText('common.api.actionFailed')).toBeInTheDocument()
    expect(
      screen.queryByRole('radiogroup', { name: 'plugin.autoUpdate.autoUpdate' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
    expect(mockSaveAutoUpgrade).not.toHaveBeenCalled()
  })

  it('should update scope from the dialog while keeping the backend returned strategy', () => {
    renderModelProviderPage()

    openUpdateSettings()
    fireEvent.click(screen.getByRole('radio', { name: 'plugin.autoUpdate.upgradeMode.partial' }))
    saveUpdateSettings()

    expect(mockSaveAutoUpgrade).toHaveBeenCalledWith({
      strategy_setting: 'latest',
      upgrade_time_of_day: 0,
      upgrade_mode: 'partial',
      exclude_plugins: [],
      include_plugins: [],
    })
  })

  it('should update time from the popover while keeping the model provider default strategy as latest', () => {
    renderModelProviderPage()

    openUpdateSettings()
    fireEvent.click(screen.getByRole('button', { name: /12:00 AM/ }))
    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'time.picker.hour' })).getByRole('option', {
        name: '1',
      }),
    )
    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'time.picker.minute' })).getByRole('option', {
        name: '15',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'time.operation.ok' }))

    expect(screen.getByRole('button', { name: /1:15 AM/ })).toBeInTheDocument()

    saveUpdateSettings()

    expect(mockSaveAutoUpgrade).toHaveBeenCalledWith({
      strategy_setting: 'latest',
      upgrade_time_of_day: 4500,
      upgrade_mode: 'all',
      exclude_plugins: [],
      include_plugins: [],
    })
  })

  it('should render configured and not configured providers sections', () => {
    renderModelProviderPage()
    expect(screen.getByText('openai')).toHaveAttribute('data-not-configured', 'false')
    expect(screen.getByText('modelProvider.modelProvider.toBeConfigured')).toBeInTheDocument()
    expect(screen.getByText('anthropic')).toHaveAttribute('data-not-configured', 'true')
  })

  it('should use the empty provider state as the production tour target when no provider cards exist', () => {
    mockProviders.splice(0)

    renderModelProviderPage()

    const selector = getStepByStepTourTargetSelector(
      STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderProduction,
    )
    const target = document.querySelector(selector)
    expect(target).toContainElement(
      screen.getByText('modelProvider.modelProvider.emptyProviderTitle'),
    )
  })

  it('should use the summary plugin map to attach plugin metadata to provider cards', () => {
    mockProviders.splice(0, mockProviders.length, {
      provider: 'langgenius/openai/openai',
      plugin_id: 'langgenius/openai-marketplace',
      label: { en_US: 'OpenAI' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    })
    mockSummaryState.plugins = {
      'langgenius/openai-marketplace': {
        installation_id: 'openai-installation',
        plugin_id: 'langgenius/openai-marketplace',
        plugin_unique_identifier: 'langgenius/openai:1.0.0',
        runtime_type: 'local',
        source: 'marketplace',
        version: '1.0.0',
      },
    }

    renderModelProviderPage()

    expect(screen.getByTestId('provider-card')).toHaveAttribute(
      'data-plugin-id',
      'langgenius/openai-marketplace',
    )
  })

  it('should render remote source from the authoritative summary plugin entry', () => {
    mockProviders.splice(0, mockProviders.length, {
      provider: 'langgenius/openai/openai',
      plugin_id: 'langgenius/openai',
      label: { en_US: 'OpenAI' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    })
    mockSummaryState.plugins = {
      'langgenius/openai': {
        installation_id: 'openai-debug-installation',
        plugin_id: 'langgenius/openai',
        plugin_unique_identifier: 'langgenius/openai:debug',
        runtime_type: 'remote',
        source: 'remote',
        version: '1.0.0',
      },
    }

    renderModelProviderPage()

    expect(screen.getByTestId('provider-card')).toHaveAttribute(
      'data-plugin-id',
      'langgenius/openai',
    )
    expect(screen.getByTestId('provider-card')).toHaveAttribute('data-plugin-source', 'remote')
  })

  it('should show provider placeholders while model providers are loading', () => {
    mockSummaryState.isLoading = true

    renderModelProviderPage()

    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    expect(screen.queryByTestId('provider-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('install-from-marketplace')).not.toBeInTheDocument()
    expect(
      screen.queryByText('modelProvider.modelProvider.emptyProviderTitle'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('modelProvider.modelProvider.noneConfigured')).not.toBeInTheDocument()
  })

  it('should filter providers based on search text', () => {
    renderModelProviderPage({ searchText: 'open' })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.getByText('openai')).toBeInTheDocument()
    expect(screen.queryByText('anthropic')).not.toBeInTheDocument()
  })

  it('should not show not-set-up empty state when search has no matches', () => {
    renderModelProviderPage({ searchText: 'non-existent' })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(
      screen.queryByText('modelProvider.modelProvider.emptyProviderTitle'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('modelProvider.modelProvider.toBeConfigured')).not.toBeInTheDocument()
  })

  it('should hide marketplace section when marketplace feature is disabled', () => {
    renderModelProviderPage({ enableMarketplace: false })

    expect(screen.queryByTestId('install-from-marketplace')).not.toBeInTheDocument()
  })

  describe('system model config status', () => {
    it('should show none-configured warning when no configured providers exist', () => {
      mockProviders.splice(0, mockProviders.length, {
        provider: 'anthropic',
        label: { en_US: 'Anthropic' },
        custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.free,
          quota_configurations: [mockQuotaConfig],
        },
      })

      renderModelProviderPage()
      expect(screen.getByText('modelProvider.modelProvider.noneConfigured')).toBeInTheDocument()
      expect(
        screen.queryByText('modelProvider.modelProvider.notConfigured'),
      ).not.toBeInTheDocument()
      expect(screen.getByText('modelProvider.modelProvider.emptyProviderTitle')).toBeInTheDocument()
      const selector = getStepByStepTourTargetSelector(
        STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderProduction,
      )
      const target = document.querySelector(selector)
      expect(target).toContainElement(screen.getByText('anthropic'))
    })

    it('should show none-configured warning when providers exist but no default models set', () => {
      renderModelProviderPage()
      expect(screen.getByText('modelProvider.modelProvider.noneConfigured')).toBeInTheDocument()
    })

    it('should not show warning when some default models are set', () => {
      mockDefaultModels.llm = {
        data: {
          model: 'gpt-4',
          model_type: 'llm',
          provider: { provider: 'openai', icon_small: { en_US: '' } },
        },
        isLoading: false,
      }

      renderModelProviderPage()
      expect(
        screen.queryByText('modelProvider.modelProvider.noneConfigured'),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText('modelProvider.modelProvider.notConfigured'),
      ).not.toBeInTheDocument()
    })

    it('should not show warning when all default models are configured', () => {
      const makeModel = (model: string, type: string) => ({
        data: {
          model,
          model_type: type,
          provider: { provider: 'openai', icon_small: { en_US: '' } },
        },
        isLoading: false,
      })
      mockDefaultModels.llm = makeModel('gpt-4', 'llm')
      mockDefaultModels['text-embedding'] = makeModel('text-embedding-3', 'text-embedding')
      mockDefaultModels.rerank = makeModel('rerank-v3', 'rerank')
      mockDefaultModels.speech2text = makeModel('whisper-1', 'speech2text')
      mockDefaultModels.tts = makeModel('tts-1', 'tts')

      renderModelProviderPage()
      expect(
        screen.queryByText('modelProvider.modelProvider.noProviderInstalled'),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText('modelProvider.modelProvider.noneConfigured'),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText('modelProvider.modelProvider.notConfigured'),
      ).not.toBeInTheDocument()
    })

    it('should not show warning while loading', () => {
      Object.keys(mockDefaultModels).forEach((key) => {
        mockDefaultModels[key] = { data: null, isLoading: true }
      })

      renderModelProviderPage()
      expect(
        screen.queryByText('modelProvider.modelProvider.noProviderInstalled'),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText('modelProvider.modelProvider.noneConfigured'),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText('modelProvider.modelProvider.notConfigured'),
      ).not.toBeInTheDocument()
    })
  })

  it('should prioritize fixed providers in visible order', () => {
    mockProviders.splice(
      0,
      mockProviders.length,
      {
        provider: 'zeta-provider',
        label: { en_US: 'Zeta Provider' },
        custom_configuration: { status: CustomConfigurationStatusEnum.active },
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.free,
          quota_configurations: [mockQuotaConfig],
        },
      },
      {
        provider: 'langgenius/anthropic/anthropic',
        label: { en_US: 'Anthropic Fixed' },
        custom_configuration: { status: CustomConfigurationStatusEnum.active },
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.free,
          quota_configurations: [mockQuotaConfig],
        },
      },
      {
        provider: 'langgenius/openai/openai',
        label: { en_US: 'OpenAI Fixed' },
        custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
        system_configuration: {
          enabled: true,
          current_quota_type: CurrentSystemQuotaTypeEnum.free,
          quota_configurations: [mockQuotaConfig],
        },
      },
    )

    renderModelProviderPage()

    const renderedProviders = screen.getAllByTestId('provider-card').map((item) => item.textContent)
    expect(renderedProviders).toEqual([
      'langgenius/openai/openai',
      'langgenius/anthropic/anthropic',
      'zeta-provider',
    ])
    expect(screen.queryByText('modelProvider.modelProvider.toBeConfigured')).not.toBeInTheDocument()
  })

  it('should prioritize debugging model plugins within their provider section', () => {
    mockProviders.splice(
      0,
      mockProviders.length,
      {
        provider: 'langgenius/openai/openai',
        label: { en_US: 'OpenAI Fixed' },
        custom_configuration: { status: CustomConfigurationStatusEnum.active },
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.free,
          quota_configurations: [mockQuotaConfig],
        },
      },
      {
        provider: 'zeta-provider',
        label: { en_US: 'Zeta Provider' },
        custom_configuration: { status: CustomConfigurationStatusEnum.active },
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.free,
          quota_configurations: [mockQuotaConfig],
        },
      },
      {
        provider: 'langgenius/normal-model/normal-model',
        label: { en_US: 'Normal Model' },
        custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.free,
          quota_configurations: [mockQuotaConfig],
        },
      },
      {
        provider: 'langgenius/debug-model/debug-model',
        plugin_id: 'langgenius/debug-model',
        label: { en_US: 'Debug Model' },
        custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.free,
          quota_configurations: [mockQuotaConfig],
        },
      },
    )
    mockSummaryState.plugins = {
      'langgenius/debug-model': {
        installation_id: 'debug-installation',
        plugin_id: 'langgenius/debug-model',
        plugin_unique_identifier: 'langgenius/debug-model:1.0.0',
        runtime_type: 'remote',
        source: 'remote',
        version: '1.0.0',
      },
    }

    renderModelProviderPage()

    const renderedProviders = screen.getAllByTestId('provider-card').map((item) => item.textContent)
    expect(renderedProviders).toEqual([
      'langgenius/openai/openai',
      'zeta-provider',
      'langgenius/debug-model/debug-model',
      'langgenius/normal-model/normal-model',
    ])
    expect(screen.getAllByTestId('provider-card')[2]).toHaveAttribute('data-not-configured', 'true')
    expect(screen.getByText('modelProvider.modelProvider.toBeConfigured')).toBeInTheDocument()
  })
})
