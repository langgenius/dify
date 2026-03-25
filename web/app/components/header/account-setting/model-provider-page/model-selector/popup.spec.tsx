import type { Model, ModelItem } from '../declarations'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ConfigurationMethodEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../declarations'
import Popup from './popup'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function renderWithProviders(ui: React.ReactElement) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

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

const mockMarketplacePlugins = vi.hoisted(() => ({
  current: [] as Array<{ plugin_id: string, latest_package_identifier: string }>,
  isLoading: false,
}))
const mockContextModelProviders = vi.hoisted(() => ({
  current: [] as Array<{
    provider: string
    label: Record<string, string>
    icon_small: Record<string, string>
    icon_small_dark?: Record<string, string>
    custom_configuration?: { status?: string }
    system_configuration?: { enabled?: boolean }
  }>,
}))
const mockTrialModels = vi.hoisted(() => ({
  current: ['test-openai', 'test-anthropic'] as string[],
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

vi.mock('@/context/global-public-context', () => ({
  useSystemFeaturesQuery: () => ({
    data: { trial_models: mockTrialModels.current },
  }),
}))

const mockTrialCredits = vi.hoisted(() => ({
  credits: 200,
  totalCredits: 200,
  isExhausted: false,
  isLoading: false,
  nextCreditResetDate: undefined as number | undefined,
}))
vi.mock('../provider-added-card/use-trial-credits', () => ({
  useTrialCredits: () => mockTrialCredits,
}))

vi.mock('../provider-added-card/model-auth-dropdown/credits-exhausted-alert', () => ({
  default: () => <div data-testid="credits-exhausted-alert" />,
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
  provider: 'custom-provider',
  icon_small: { en_US: '', zh_Hans: '' },
  label: { en_US: 'Custom Provider', zh_Hans: 'Custom Provider' },
  models: [makeModelItem()],
  status: ModelStatusEnum.active,
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
    mockTrialModels.current = ['test-openai', 'test-anthropic']
    Object.assign(mockTrialCredits, {
      credits: 200,
      totalCredits: 200,
      isExhausted: false,
      isLoading: false,
      nextCreditResetDate: undefined,
    })
  })

  it('should filter models by search and allow clearing search', () => {
    renderWithProviders(
      <Popup
        modelList={[makeModel()]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    expect(screen.getByText('custom-provider')).toBeInTheDocument()

    const input = screen.getByPlaceholderText('datasetSettings.form.searchModel')
    fireEvent.change(input, { target: { value: 'not-found' } })
    expect(screen.getByText('No model found for “not-found”')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '' } })
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.getByText('custom-provider')).toBeInTheDocument()
  })

  it('should filter by scope features including toolCall and non-toolCall checks', () => {
    const modelList = [
      makeModel({ models: [makeModelItem({ features: [ModelFeatureEnum.toolCall, ModelFeatureEnum.vision] })] }),
    ]

    // When tool-call support is missing, it should be filtered out.
    mockSupportFunctionCall.mockReturnValue(false)
    const { unmount } = renderWithProviders(
      <Popup
        modelList={modelList}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.toolCall, ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('No model found for “”')).toBeInTheDocument()

    // When tool-call support exists, the non-toolCall feature check should also pass.
    unmount()
    mockSupportFunctionCall.mockReturnValue(true)
    const { unmount: unmount2 } = renderWithProviders(
      <Popup
        modelList={modelList}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.toolCall, ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('custom-provider')).toBeInTheDocument()

    unmount2()
    const { unmount: unmount3 } = renderWithProviders(
      <Popup
        modelList={modelList}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('custom-provider')).toBeInTheDocument()

    // When features are missing, non-toolCall feature checks should fail.
    unmount3()
    renderWithProviders(
      <Popup
        modelList={[makeModel({ models: [makeModelItem({ features: undefined })] })]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('No model found for “”')).toBeInTheDocument()
  })

  it('should match labels from other languages when current language key is missing', () => {
    mockLanguage = 'fr_FR'

    renderWithProviders(
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

    expect(screen.getByText('No model found for “gpt”')).toBeInTheDocument()
  })

  it('should filter out model when features array exists but does not include required scopeFeature', () => {
    const modelWithToolCallOnly = makeModel({
      models: [makeModelItem({ features: [ModelFeatureEnum.toolCall] })],
    })

    renderWithProviders(
      <Popup
        modelList={[modelWithToolCallOnly]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.vision]}
      />,
    )

    // The model item should be filtered out because it has toolCall but not vision
    expect(screen.queryByText('custom-provider')).not.toBeInTheDocument()
  })

  it('should render marketplace providers that are not installed yet', () => {
    renderWithProviders(
      <Popup
        modelList={[makeModel()]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    expect(screen.getByText('TestOpenAI')).toBeInTheDocument()
    expect(screen.getByText('TestAnthropic')).toBeInTheDocument()
  })

  it('should open provider settings when clicking footer link', () => {
    renderWithProviders(
      <Popup
        modelList={[makeModel()]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('common.modelProvider.selector.modelProviderSettings'))

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
      payload: 'model-provider',
    })
  })

  it('should call onHide when footer settings link is clicked', () => {
    const mockOnHide = vi.fn()
    renderWithProviders(
      <Popup
        modelList={[makeModel()]}
        onSelect={vi.fn()}
        onHide={mockOnHide}
      />,
    )

    fireEvent.click(screen.getByText('common.modelProvider.selector.modelProviderSettings'))

    expect(mockOnHide).toHaveBeenCalled()
  })

  it('should match model label when searchText is non-empty and label key exists for current language', () => {
    renderWithProviders(
      <Popup
        modelList={[makeModel()]}
        onSelect={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    // GPT-4 label has en_US key, so modelItem.label[language] is defined
    const input = screen.getByPlaceholderText('datasetSettings.form.searchModel')
    fireEvent.change(input, { target: { value: 'gpt' } })

    expect(screen.getByText('No model found for “gpt”')).toBeInTheDocument()
  })
})
