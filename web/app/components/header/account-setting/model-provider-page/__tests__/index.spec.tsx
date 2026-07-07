import type { ReactNode } from 'react'
import type { PluginDeclaration, PluginDetail } from '@/app/components/plugins/types'
import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import { getStepByStepTourTargetSelector, STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import {
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  QuotaUnitEnum,
} from '../declarations'
import ModelProviderPage from '../index'

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

const { mockSetAccountSettingModal, mockSaveAutoUpgrade } = vi.hoisted(() => ({
  mockSetAccountSettingModal: vi.fn(),
  mockSaveAutoUpgrade: vi.fn(),
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

const { mockProviderContextState, mockRefreshModelProviders } = vi.hoisted(() => ({
  mockProviderContextState: {
    isLoadingModelProviders: false,
  },
  mockRefreshModelProviders: vi.fn(),
}))

const { mockInstalledModelPlugins, mockUseInstalledPluginList } = vi.hoisted(() => ({
  mockInstalledModelPlugins: {
    value: [] as PluginDetail[],
  },
  mockUseInstalledPluginList: vi.fn(),
}))

const mockQuotaConfig = {
  quota_type: CurrentSystemQuotaTypeEnum.free,
  quota_unit: QuotaUnitEnum.times,
  quota_limit: 100,
  quota_used: 1,
  last_used: 0,
  is_valid: true,
}

const renderModelProviderPage = (
  props: {
    enableMarketplace?: boolean
    searchText?: string
    stickyToolbar?: boolean
  } = {},
) => {
  const { searchText = '', enableMarketplace = true, stickyToolbar = true } = props
  return renderWithSystemFeatures((
    <ModelProviderPage
      searchText={searchText}
      stickyToolbar={stickyToolbar}
    />
  ), {
    systemFeatures: { enable_marketplace: enableMarketplace },
  },
  )
}

const saveUpdateSettings = () => {
  fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
}

const createPluginDeclaration = (overrides: Partial<PluginDeclaration> = {}): PluginDeclaration => ({
  plugin_unique_identifier: 'langgenius/debug-model:1.0.0',
  version: '1.0.0',
  author: 'langgenius',
  icon: 'debug-model.png',
  icon_dark: 'debug-model-dark.png',
  name: 'debug-model',
  category: PluginCategoryEnum.model,
  label: { en_US: 'Debug Model' } as unknown as PluginDeclaration['label'],
  description: { en_US: 'Debug model provider' } as unknown as PluginDeclaration['description'],
  created_at: '2024-01-01',
  resource: null,
  plugins: null,
  verified: false,
  endpoint: null,
  tool: undefined,
  datasource: undefined,
  model: {},
  tags: [],
  agent_strategy: null,
  meta: {
    version: '1.0.0',
  },
  trigger: {} as unknown as PluginDeclaration['trigger'],
  ...overrides,
})

const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => {
  const {
    declaration: overrideDeclaration,
    plugin_id: overridePluginId,
    ...restOverrides
  } = overrides
  const declaration = overrideDeclaration ?? createPluginDeclaration()
  const pluginId = overridePluginId ?? 'langgenius/debug-model'

  return {
    id: 'plugin-installation-id',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    name: declaration.name,
    plugin_id: pluginId,
    plugin_unique_identifier: declaration.plugin_unique_identifier,
    declaration,
    installation_id: 'plugin-installation-id',
    tenant_id: 'tenant-id',
    endpoints_setups: 0,
    endpoints_active: 0,
    version: '1.0.0',
    latest_version: '1.0.0',
    latest_unique_identifier: declaration.plugin_unique_identifier,
    source: PluginSource.debugging,
    meta: {
      repo: '',
      version: '1.0.0',
      package: '',
    },
    status: 'active',
    deprecated_reason: '',
    alternative_plugin_id: '',
    ...restOverrides,
  }
}

const mockProviders = [
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
  {
    provider: 'anthropic',
    label: { en_US: 'Anthropic' },
    custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
    system_configuration: {
      enabled: false,
      current_quota_type: CurrentSystemQuotaTypeEnum.free,
      quota_configurations: [mockQuotaConfig],
    },
  },
]

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    modelProviders: mockProviders,
    isLoadingModelProviders: mockProviderContextState.isLoadingModelProviders,
    refreshModelProviders: mockRefreshModelProviders,
  }),
}))

const mockDefaultModels: Record<string, { data: unknown, isLoading: boolean }> = {
  'llm': { data: null, isLoading: false },
  'text-embedding': { data: null, isLoading: false },
  'rerank': { data: null, isLoading: false },
  'speech2text': { data: null, isLoading: false },
  'tts': { data: null, isLoading: false },
}

vi.mock('../hooks', () => ({
  useDefaultModel: (type: string) => mockDefaultModels[type] ?? { data: null, isLoading: false },
  useLanguage: () => 'en_US',
}))

vi.mock('../install-from-marketplace', () => ({
  default: () => <div data-testid="install-from-marketplace" />,
}))

vi.mock('../provider-added-card', () => ({
  default: ({
    notConfigured,
    provider,
    pluginDetail,
  }: {
    notConfigured?: boolean
    provider: { provider: string }
    pluginDetail?: { plugin_id: string, source?: string }
  }) => (
    <div
      data-testid="provider-card"
      data-not-configured={String(!!notConfigured)}
      data-plugin-id={pluginDetail?.plugin_id ?? ''}
      data-plugin-source={pluginDetail?.source ?? ''}
    >
      {provider.provider}
    </div>
  ),
}))

vi.mock('../provider-added-card/quota-panel', () => ({
  default: () => <div data-testid="quota-panel" />,
}))

vi.mock('../system-model-selector', () => ({
  default: ({ className, notConfigured }: { className?: string, notConfigured?: boolean }) => (
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
    canSetPluginPreferences: true,
  }),
  default: () => ({
    referenceSetting: mockReferenceSetting,
    canSetPermissions: true,
    canSetPluginPreferences: true,
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: (...args: unknown[]) => {
    mockUseInstalledPluginList(...args)
    return {
      data: { plugins: mockInstalledModelPlugins.value },
    }
  },
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

vi.mock('@langgenius/dify-ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ render }: { render: ReactNode }) => render,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="update-setting-dialog">{children}</div>
  ),
  DialogTitle: () => null,
  DialogCloseButton: () => <button type="button" aria-label="close" />,
}))

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: (selector: (state: { setShowAccountSettingModal: typeof mockSetAccountSettingModal }) => unknown) =>
    selector({ setShowAccountSettingModal: mockSetAccountSettingModal }),
}))

vi.mock('@/app/components/base/date-and-time-picker/time-picker', () => ({
  default: ({
    value,
    onChange,
    renderTrigger,
  }: {
    value?: string | { format: (format: string) => string }
    onChange: (value: { hour: () => number, minute: () => number }) => void
    renderTrigger: (params: { inputElem: ReactNode, onClick: () => void, isOpen: boolean }) => ReactNode
  }) => {
    const displayValue = typeof value === 'string' ? value : value?.format('HH:mm')

    return (
      <div data-testid="update-time-picker">
        {renderTrigger({
          inputElem: <span data-testid="update-time-value">{displayValue}</span>,
          onClick: vi.fn(),
          isOpen: false,
        })}
        <button
          type="button"
          onClick={() => onChange({
            hour: () => 1,
            minute: () => 15,
          })}
        >
          set update time
        </button>
      </div>
    )
  },
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
                          queryKey: ['workspaces', 'current', 'plugin', 'list', 'installations', 'ids', 'post'],
                          queryFn: () => new Promise(() => {}),
                        }),
                      },
                    },
                  },
                  latestVersions: {
                    post: {
                      queryOptions: () => ({
                        queryKey: ['workspaces', 'current', 'plugin', 'list', 'latestVersions', 'post'],
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

describe('ModelProviderPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockUseInstalledPluginList.mockClear()
    mockRefreshModelProviders.mockClear()
    mockInstalledModelPlugins.value = []
    mockProviderContextState.isLoadingModelProviders = false
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
    mockProviders.splice(0, mockProviders.length, {
      provider: 'openai',
      label: { en_US: 'OpenAI' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    }, {
      provider: 'anthropic',
      label: { en_US: 'Anthropic' },
      custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render main elements', () => {
    renderModelProviderPage()
    expect(screen.getByPlaceholderText('common.modelProvider.searchModels')).toBeInTheDocument()
    const autoUpdateButton = screen.getByRole('button', { name: /plugin\.autoUpdate\.autoUpdate/ })
    const systemModelSelector = screen.getByTestId('system-model-selector')
    expect(autoUpdateButton).toBeInTheDocument()
    expect(systemModelSelector).toBeInTheDocument()
    expect(systemModelSelector.compareDocumentPosition(autoUpdateButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('install-from-marketplace')).toBeInTheDocument()
  })

  it('should align the toolbar without extra internal top offset', () => {
    const { container } = renderModelProviderPage()

    expect(container.firstElementChild).toHaveClass('relative')
    expect(container.firstElementChild).not.toHaveClass('-mt-2', 'pt-1')
    expect(container.firstElementChild?.firstElementChild).toHaveClass('sticky', 'top-0', 'z-10', '-mx-6', 'mb-2', 'flex', 'bg-components-panel-bg', 'px-6', 'pb-2')
    expect(container.firstElementChild?.firstElementChild).not.toHaveClass('mb-4')
  })

  it('should show the current auto-update strategy on the update setting button', () => {
    renderModelProviderPage()

    expect(screen.getAllByText('plugin.autoUpdate.strategy.latest.name')[0]).toBeInTheDocument()
    expect(screen.getAllByTestId('update-setting-dialog')[0]).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'plugin.autoUpdate.autoUpdate' })).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.scope')).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.updateTime')).toBeInTheDocument()
    expect(screen.getByTestId('update-time-picker')).toBeInTheDocument()
    expect(screen.getByText('autoUpdate.changeTimezone')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'plugin.autoUpdate.strategy.fixOnly.name' })).toBeInTheDocument()
  })

  it('should not expose editable update settings while backend auto-upgrade data is loading', () => {
    mockReferenceSetting.auto_upgrade = undefined

    renderModelProviderPage()

    const updateSettingButton = screen.getByText('plugin.autoUpdate.autoUpdate').closest('button')
    expect(updateSettingButton).not.toBeDisabled()
    expect(screen.queryByText('plugin.autoUpdate.strategy.latest.name')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('common.loading')
    expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
    expect(mockSaveAutoUpgrade).not.toHaveBeenCalled()
    expect(screen.getByTestId('update-setting-dialog')).toBeInTheDocument()
  })

  it('should render a failure state when backend auto-upgrade data fails', () => {
    mockReferenceSetting.auto_upgrade = undefined
    mockAutoUpgradeError.value = new Error('auto-upgrade failed')

    renderModelProviderPage()

    expect(screen.getByText('common.api.actionFailed')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'plugin.autoUpdate.autoUpdate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
    expect(mockSaveAutoUpgrade).not.toHaveBeenCalled()
  })

  it('should update scope from the dialog while keeping the backend returned strategy', () => {
    renderModelProviderPage()

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

    expect(screen.getByTestId('update-time-value')).toHaveTextContent('00:00')

    fireEvent.click(screen.getByRole('button', { name: 'set update time' }))

    expect(screen.getByTestId('update-time-value')).toHaveTextContent('01:15')

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
    expect(screen.getByText('openai')).toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.toBeConfigured')).toBeInTheDocument()
    expect(screen.getByText('anthropic')).toBeInTheDocument()
  })

  it('should use the empty provider state as the production tour target when no provider cards exist', () => {
    mockProviders.splice(0)

    renderModelProviderPage()

    const selector = getStepByStepTourTargetSelector(STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderProduction)
    const target = document.querySelector(selector)
    expect(target).toContainElement(screen.getByText('common.modelProvider.emptyProviderTitle'))
  })

  it('should use the model plugin installation list to attach plugin detail to provider cards', () => {
    mockProviders.splice(0, mockProviders.length, {
      provider: 'langgenius/openai/openai',
      label: { en_US: 'OpenAI' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    })
    mockInstalledModelPlugins.value = [
      createPluginDetail({
        plugin_id: 'langgenius/openai',
        declaration: createPluginDeclaration({
          plugin_unique_identifier: 'langgenius/openai:1.0.0',
          name: 'openai',
          label: { en_US: 'OpenAI Plugin' } as unknown as PluginDeclaration['label'],
        }),
      }),
    ]

    renderModelProviderPage()

    expect(mockUseInstalledPluginList).toHaveBeenCalledWith(false, 100, { category: PluginCategoryEnum.model })
    expect(screen.getByTestId('provider-card')).toHaveAttribute('data-plugin-id', 'langgenius/openai')
    expect(screen.queryByText('OpenAI Plugin')).not.toBeInTheDocument()
  })

  it('should not render installed model plugins that are not registered as model providers', () => {
    mockInstalledModelPlugins.value = [
      createPluginDetail({
        plugin_id: 'langgenius/debug-model',
        declaration: createPluginDeclaration({
          label: { en_US: 'Debug Model' } as unknown as PluginDeclaration['label'],
          description: { en_US: 'Debug model provider' } as unknown as PluginDeclaration['description'],
        }),
      }),
    ]

    renderModelProviderPage()

    expect(screen.queryByText('Debug Model')).not.toBeInTheDocument()
    expect(screen.queryByText('langgenius/debug-model')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'plugin actions langgenius/debug-model' })).not.toBeInTheDocument()
  })

  it('should refresh model providers once when a debugging model plugin is missing from providers', () => {
    mockInstalledModelPlugins.value = [
      createPluginDetail({
        plugin_id: 'langgenius/debug-model',
        declaration: createPluginDeclaration({
          label: { en_US: 'Debug Model' } as unknown as PluginDeclaration['label'],
        }),
      }),
    ]

    renderModelProviderPage()

    expect(mockRefreshModelProviders).toHaveBeenCalledTimes(1)
  })

  it('should prefer debugging plugin detail when an installed model plugin shares the same plugin id', () => {
    mockProviders.splice(0, mockProviders.length, {
      provider: 'langgenius/openai/openai',
      label: { en_US: 'OpenAI' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    })
    mockInstalledModelPlugins.value = [
      createPluginDetail({
        plugin_id: 'langgenius/openai',
        declaration: createPluginDeclaration({
          plugin_unique_identifier: 'langgenius/openai:debug',
          name: 'openai',
          label: { en_US: 'OpenAI Debug Plugin' } as unknown as PluginDeclaration['label'],
        }),
        source: PluginSource.debugging,
      }),
      createPluginDetail({
        plugin_id: 'langgenius/openai',
        declaration: createPluginDeclaration({
          plugin_unique_identifier: 'langgenius/openai:1.0.0',
          name: 'openai',
          label: { en_US: 'OpenAI Installed Plugin' } as unknown as PluginDeclaration['label'],
        }),
        source: PluginSource.marketplace,
      }),
    ]

    renderModelProviderPage()

    expect(screen.getByTestId('provider-card')).toHaveAttribute('data-plugin-id', 'langgenius/openai')
    expect(screen.getByTestId('provider-card')).toHaveAttribute('data-plugin-source', PluginSource.debugging)
    expect(mockRefreshModelProviders).toHaveBeenCalledTimes(1)
  })

  it('should show provider placeholders while model providers are loading', () => {
    mockProviderContextState.isLoadingModelProviders = true

    renderModelProviderPage()

    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    expect(screen.queryByTestId('provider-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('install-from-marketplace')).not.toBeInTheDocument()
    expect(screen.queryByText('common.modelProvider.emptyProviderTitle')).not.toBeInTheDocument()
    expect(screen.queryByText('common.modelProvider.noneConfigured')).not.toBeInTheDocument()
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
    expect(screen.queryByText('common.modelProvider.emptyProviderTitle')).not.toBeInTheDocument()
    expect(screen.queryByText('common.modelProvider.toBeConfigured')).not.toBeInTheDocument()
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
      expect(screen.getByText('common.modelProvider.noneConfigured')).toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.notConfigured')).not.toBeInTheDocument()
      expect(screen.getByText('common.modelProvider.emptyProviderTitle')).toBeInTheDocument()
      const selector = getStepByStepTourTargetSelector(STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderProduction)
      const target = document.querySelector(selector)
      expect(target).toContainElement(screen.getByText('anthropic'))
    })

    it('should show none-configured warning when providers exist but no default models set', () => {
      renderModelProviderPage()
      expect(screen.getByText('common.modelProvider.noneConfigured')).toBeInTheDocument()
    })

    it('should render the none-configured warning inline with the system model selector', () => {
      const { container } = renderModelProviderPage()
      const warning = screen.getByText('common.modelProvider.noneConfigured')
      const warningContainer = warning.closest('.rounded-lg')
      const systemModelSelector = screen.getByTestId('system-model-selector')

      expect(warning.closest('.fixed')).toBeNull()
      expect(warningContainer).toHaveClass('inline-flex', 'bg-components-panel-bg-blur')
      expect(warningContainer).toContainElement(systemModelSelector)
      expect(systemModelSelector).toHaveAttribute('data-not-configured', 'true')
      expect(systemModelSelector).toHaveClass('h-6')
      expect(container.firstElementChild).toHaveClass('relative')
    })

    it('should not show warning when some default models are set', () => {
      mockDefaultModels.llm = {
        data: { model: 'gpt-4', model_type: 'llm', provider: { provider: 'openai', icon_small: { en_US: '' } } },
        isLoading: false,
      }

      renderModelProviderPage()
      expect(screen.queryByText('common.modelProvider.noneConfigured')).not.toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.notConfigured')).not.toBeInTheDocument()
    })

    it('should not show warning when all default models are configured', () => {
      const makeModel = (model: string, type: string) => ({
        data: { model, model_type: type, provider: { provider: 'openai', icon_small: { en_US: '' } } },
        isLoading: false,
      })
      mockDefaultModels.llm = makeModel('gpt-4', 'llm')
      mockDefaultModels['text-embedding'] = makeModel('text-embedding-3', 'text-embedding')
      mockDefaultModels.rerank = makeModel('rerank-v3', 'rerank')
      mockDefaultModels.speech2text = makeModel('whisper-1', 'speech2text')
      mockDefaultModels.tts = makeModel('tts-1', 'tts')

      renderModelProviderPage()
      expect(screen.queryByText('common.modelProvider.noProviderInstalled')).not.toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.noneConfigured')).not.toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.notConfigured')).not.toBeInTheDocument()
    })

    it('should not show warning while loading', () => {
      Object.keys(mockDefaultModels).forEach((key) => {
        mockDefaultModels[key] = { data: null, isLoading: true }
      })

      renderModelProviderPage()
      expect(screen.queryByText('common.modelProvider.noProviderInstalled')).not.toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.noneConfigured')).not.toBeInTheDocument()
      expect(screen.queryByText('common.modelProvider.notConfigured')).not.toBeInTheDocument()
    })
  })

  it('should prioritize fixed providers in visible order', () => {
    mockProviders.splice(0, mockProviders.length, {
      provider: 'zeta-provider',
      label: { en_US: 'Zeta Provider' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    }, {
      provider: 'langgenius/anthropic/anthropic',
      label: { en_US: 'Anthropic Fixed' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    }, {
      provider: 'langgenius/openai/openai',
      label: { en_US: 'OpenAI Fixed' },
      custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
      system_configuration: {
        enabled: true,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    })

    renderModelProviderPage()

    const renderedProviders = screen.getAllByTestId('provider-card').map(item => item.textContent)
    expect(renderedProviders).toEqual([
      'langgenius/openai/openai',
      'langgenius/anthropic/anthropic',
      'zeta-provider',
    ])
    expect(screen.queryByText('common.modelProvider.toBeConfigured')).not.toBeInTheDocument()
  })

  it('should prioritize debugging model plugins within their provider section', () => {
    mockProviders.splice(0, mockProviders.length, {
      provider: 'langgenius/openai/openai',
      label: { en_US: 'OpenAI Fixed' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    }, {
      provider: 'zeta-provider',
      label: { en_US: 'Zeta Provider' },
      custom_configuration: { status: CustomConfigurationStatusEnum.active },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    }, {
      provider: 'langgenius/normal-model/normal-model',
      label: { en_US: 'Normal Model' },
      custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    }, {
      provider: 'langgenius/debug-model/debug-model',
      label: { en_US: 'Debug Model' },
      custom_configuration: { status: CustomConfigurationStatusEnum.noConfigure },
      system_configuration: {
        enabled: false,
        current_quota_type: CurrentSystemQuotaTypeEnum.free,
        quota_configurations: [mockQuotaConfig],
      },
    })
    mockInstalledModelPlugins.value = [
      createPluginDetail({
        plugin_id: 'langgenius/debug-model',
        declaration: createPluginDeclaration({
          plugin_unique_identifier: 'langgenius/debug-model:1.0.0',
          name: 'debug-model',
          label: { en_US: 'Debug Model' } as unknown as PluginDeclaration['label'],
        }),
      }),
    ]

    renderModelProviderPage()

    const renderedProviders = screen.getAllByTestId('provider-card').map(item => item.textContent)
    expect(renderedProviders).toEqual([
      'langgenius/openai/openai',
      'zeta-provider',
      'langgenius/debug-model/debug-model',
      'langgenius/normal-model/normal-model',
    ])
    expect(screen.getAllByTestId('provider-card')[2]).toHaveAttribute('data-not-configured', 'true')
    expect(screen.getByText('common.modelProvider.toBeConfigured')).toBeInTheDocument()
  })
})
