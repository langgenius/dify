import type { Model, ModelItem, ModelProvider } from '../declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  ConfigurationMethodEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../declarations'
import Popup from './popup'

let mockLanguage = 'en_US'

const mockSetShowAccountSettingModal = vi.hoisted(() => vi.fn())
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
  }),
}))

const mockSupportFunctionCall = vi.hoisted(() => vi.fn())
vi.mock('@/utils/tool-call', () => ({
  supportFunctionCall: mockSupportFunctionCall,
}))

const mockCloseActiveTooltip = vi.hoisted(() => vi.fn())
vi.mock('@/app/components/base/tooltip/TooltipManager', () => ({
  tooltipManager: {
    closeActiveTooltip: mockCloseActiveTooltip,
    register: vi.fn(),
    clear: vi.fn(),
  },
}))

type MockMarketplacePlugin = {
  plugin_id: string
  latest_package_identifier: string
}

type MockContextProvider = Pick<ModelProvider, 'provider' | 'custom_configuration' | 'system_configuration'>

const mockMarketplacePlugins = vi.hoisted(() => ({
  current: [] as MockMarketplacePlugin[],
  isLoading: false,
}))
const mockContextModelProviders = vi.hoisted(() => ({
  current: [] as MockContextProvider[],
}))
vi.mock('../hooks', async () => {
  const actual = await vi.importActual<typeof import('../hooks')>('../hooks')
  return {
    ...actual,
    useLanguage: () => mockLanguage,
    useMarketplaceAllPlugins: () => ({
      plugins: mockMarketplacePlugins.current,
      isLoading: mockMarketplacePlugins.isLoading,
    }),
  }
})

vi.mock('./popup-item', () => ({
  default: ({ model }: { model: Model }) => <div>{model.provider}</div>,
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({ modelProviders: mockContextModelProviders.current }),
}))

vi.mock('../provider-added-card/use-trial-credits', () => ({
  useTrialCredits: () => ({
    credits: 200,
    totalCredits: 200,
    isExhausted: false,
    isLoading: false,
    nextCreditResetDate: undefined,
  }),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}))

const mockInstallMutateAsync = vi.hoisted(() => vi.fn())
vi.mock('@/service/use-plugins', () => ({
  useInstallPackageFromMarketPlace: () => ({ mutateAsync: mockInstallMutateAsync }),
}))

const mockRefreshPluginList = vi.hoisted(() => vi.fn())
vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: mockRefreshPluginList }),
}))

const mockCheck = vi.hoisted(() => vi.fn())
vi.mock('@/app/components/plugins/install-plugin/base/check-task-status', () => ({
  default: () => ({ check: mockCheck }),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: vi.fn(() => 'https://marketplace.example.com'),
}))

vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils')
  return {
    ...actual,
    MODEL_PROVIDER_QUOTA_GET_PAID: ['test-openai', 'test-anthropic'],
    providerIconMap: {
      'test-openai': ({ className }: { className?: string }) => <span className={className}>OAI</span>,
      'test-anthropic': ({ className }: { className?: string }) => <span className={className}>ANT</span>,
    },
    modelNameMap: {
      'test-openai': 'TestOpenAI',
      'test-anthropic': 'TestAnthropic',
    },
    providerKeyToPluginId: {
      'test-openai': 'langgenius/openai',
      'test-anthropic': 'langgenius/anthropic',
    },
  }
})

const makeModelItem = (overrides: Partial<ModelItem> = {}): ModelItem => ({
  model: 'gpt-4',
  label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
  model_type: ModelTypeEnum.textGeneration,
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: {},
  load_balancing_enabled: false,
  ...overrides,
})

const makeModel = (overrides: Partial<Model> = {}): Model => ({
  provider: 'openai',
  icon_small: { en_US: '', zh_Hans: '' },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  models: [makeModelItem()],
  status: ModelStatusEnum.active,
  ...overrides,
})

const makeContextProvider = (overrides: Partial<MockContextProvider> = {}): MockContextProvider => ({
  provider: 'test-openai',
  custom_configuration: {
    status: 'no-configure',
  } as MockContextProvider['custom_configuration'],
  system_configuration: {
    enabled: false,
  } as MockContextProvider['system_configuration'],
  ...overrides,
})

describe('Popup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLanguage = 'en_US'
    mockSupportFunctionCall.mockReturnValue(true)
    mockMarketplacePlugins.current = []
    mockMarketplacePlugins.isLoading = false
    mockContextModelProviders.current = []
  })

  it('should filter models by search and allow clearing search', () => {
    const { container } = render(
      <Popup
        modelList={[makeModel()]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    expect(screen.getByText('openai')).toBeInTheDocument()

    const input = screen.getByPlaceholderText('datasetSettings.form.searchModel')
    fireEvent.change(input, { target: { value: 'not-found' } })
    expect(screen.getByText('No model found for \u201Cnot-found\u201D')).toBeInTheDocument()

    const clearIcon = container.querySelector('.i-custom-vender-solid-general-x-circle')
    expect(clearIcon).toBeInTheDocument()
    fireEvent.click(clearIcon!)
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('should filter by scope features including toolCall and non-toolCall checks', () => {
    const modelList = [
      makeModel({ models: [makeModelItem({ features: [ModelFeatureEnum.toolCall, ModelFeatureEnum.vision] })] }),
    ]

    mockSupportFunctionCall.mockReturnValue(false)
    const { unmount } = render(
      <Popup
        modelList={modelList}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.toolCall, ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('No model found for \u201C\u201D')).toBeInTheDocument()

    unmount()
    mockSupportFunctionCall.mockReturnValue(true)
    const { unmount: unmount2 } = render(
      <Popup
        modelList={modelList}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.toolCall, ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('openai')).toBeInTheDocument()

    unmount2()
    const { unmount: unmount3 } = render(
      <Popup
        modelList={modelList}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('openai')).toBeInTheDocument()

    unmount3()
    render(
      <Popup
        modelList={[makeModel({ models: [makeModelItem({ features: undefined })] })]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('No model found for \u201C\u201D')).toBeInTheDocument()
  })

  it('should match labels from other languages when current language key is missing', () => {
    mockLanguage = 'fr_FR'

    render(
      <Popup
        modelList={[makeModel()]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText('datasetSettings.form.searchModel'),
      { target: { value: 'gpt' } },
    )

    expect(screen.getByText('openai')).toBeInTheDocument()
  })

  it('should close tooltip on scroll', () => {
    const { container } = render(
      <Popup
        modelList={[makeModel()]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    fireEvent.scroll(container.firstElementChild as HTMLElement)
    expect(mockCloseActiveTooltip).toHaveBeenCalled()
  })

  it('should open provider settings when clicking footer link', () => {
    const onHide = vi.fn()
    render(
      <Popup
        modelList={[makeModel()]}
        onSelect={vi.fn()}
        onHide={onHide}
      />,
    )

    fireEvent.click(screen.getByText('common.modelProvider.selector.modelProviderSettings'))

    expect(onHide).toHaveBeenCalled()
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
      payload: 'provider',
    })
  })

  it('should show empty state when no providers are configured', () => {
    const onHide = vi.fn()
    render(
      <Popup
        modelList={[]}
        onSelect={vi.fn()}
        onHide={onHide}
      />,
    )

    expect(screen.getByText(/modelProvider\.selector\.noProviderConfigured(?!Desc)/)).toBeInTheDocument()
    expect(screen.getByText(/modelProvider\.selector\.noProviderConfiguredDesc/)).toBeInTheDocument()

    fireEvent.click(screen.getByText(/modelProvider\.selector\.configure/))
    expect(onHide).toHaveBeenCalled()
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
      payload: 'provider',
    })
  })

  it('should render marketplace providers that are not installed', () => {
    mockContextModelProviders.current = [makeContextProvider({ provider: 'test-openai' })]

    render(
      <Popup
        modelList={[]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    expect(screen.queryByText('TestOpenAI')).not.toBeInTheDocument()
    expect(screen.getByText('TestAnthropic')).toBeInTheDocument()
    expect(screen.getByText(/modelProvider\.selector\.fromMarketplace/)).toBeInTheDocument()
    expect(screen.getByText(/modelProvider\.selector\.discoverMoreInMarketplace/)).toBeInTheDocument()
  })

  it('should hide installed marketplace providers when they are absent from the current modelList', () => {
    mockContextModelProviders.current = [makeContextProvider({ provider: 'test-anthropic' })]

    render(
      <Popup
        modelList={[]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    expect(screen.queryByText('test-anthropic')).not.toBeInTheDocument()
    expect(screen.queryByText('TestAnthropic')).not.toBeInTheDocument()
    expect(screen.getByText('TestOpenAI')).toBeInTheDocument()
  })

  it('should toggle marketplace section collapse', () => {
    render(
      <Popup
        modelList={[]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    expect(screen.getByText('TestOpenAI')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/modelProvider\.selector\.fromMarketplace/))

    expect(screen.queryByText('TestOpenAI')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(/modelProvider\.selector\.fromMarketplace/))

    expect(screen.getByText('TestOpenAI')).toBeInTheDocument()
  })

  it('should install plugin when clicking install button', async () => {
    mockMarketplacePlugins.current = [
      { plugin_id: 'langgenius/openai', latest_package_identifier: 'langgenius/openai:1.0.0' },
    ]
    mockInstallMutateAsync.mockResolvedValue({ all_installed: true, task_id: 'task-1' })

    render(
      <Popup
        modelList={[]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    const installButtons = screen.getAllByText(/common\.modelProvider\.selector\.install/)
    fireEvent.click(installButtons[0])

    await waitFor(() => {
      expect(mockInstallMutateAsync).toHaveBeenCalledWith('langgenius/openai:1.0.0')
    })
    expect(mockRefreshPluginList).toHaveBeenCalled()
  })

  it('should handle install failure gracefully', async () => {
    mockMarketplacePlugins.current = [
      { plugin_id: 'langgenius/openai', latest_package_identifier: 'langgenius/openai:1.0.0' },
    ]
    mockInstallMutateAsync.mockRejectedValue(new Error('Install failed'))

    render(
      <Popup
        modelList={[]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    const installButtons = screen.getAllByText(/common\.modelProvider\.selector\.install/)
    fireEvent.click(installButtons[0])

    await waitFor(() => {
      expect(mockInstallMutateAsync).toHaveBeenCalled()
    })

    // Should not crash, install buttons should still be available
    expect(screen.getAllByText(/common\.modelProvider\.selector\.install/).length).toBeGreaterThan(0)
  })

  it('should run checkTaskStatus when not all_installed', async () => {
    mockMarketplacePlugins.current = [
      { plugin_id: 'langgenius/openai', latest_package_identifier: 'langgenius/openai:1.0.0' },
    ]
    mockInstallMutateAsync.mockResolvedValue({ all_installed: false, task_id: 'task-1' })
    mockCheck.mockResolvedValue(undefined)

    render(
      <Popup
        modelList={[]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    const installButtons = screen.getAllByText(/common\.modelProvider\.selector\.install/)
    fireEvent.click(installButtons[0])

    await waitFor(() => {
      expect(mockCheck).toHaveBeenCalledWith({
        taskId: 'task-1',
        pluginUniqueIdentifier: 'langgenius/openai:1.0.0',
      })
    })
    expect(mockRefreshPluginList).toHaveBeenCalled()
  })
})
