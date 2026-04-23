import type { ReactElement } from 'react'
import type { Model, ModelItem, ModelProvider } from '../../declarations'
import type { PopupProps } from '../popup'
import type { SystemFeatures } from '@/types/feature'
import { Combobox } from '@langgenius/dify-ui/combobox'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import {
  ConfigurationMethodEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../../declarations'
import Popup from '../popup'

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

type MockMarketplacePlugin = {
  plugin_id: string
  latest_package_identifier: string
}

type MockContextProvider = Pick<ModelProvider, 'provider' | 'label' | 'icon_small' | 'icon_small_dark' | 'custom_configuration' | 'system_configuration'>

const mockMarketplacePlugins = vi.hoisted(() => ({
  current: [] as MockMarketplacePlugin[],
  isLoading: false,
}))
const mockContextModelProviders = vi.hoisted(() => ({
  current: [] as MockContextProvider[],
}))
const mockTrialModels = vi.hoisted(() => ({
  current: ['test-openai', 'test-anthropic'] as string[],
}))
vi.mock('../../hooks', async () => {
  const actual = await vi.importActual<typeof import('../../hooks')>('../../hooks')
  return {
    ...actual,
    useLanguage: () => mockLanguage,
    useMarketplaceAllPlugins: () => ({
      plugins: mockMarketplacePlugins.current,
      isLoading: mockMarketplacePlugins.isLoading,
    }),
  }
})

vi.mock('../popup-item', () => ({
  default: ({ model }: { model: Model }) => (
    <div>
      <span>{model.provider}</span>
      {model.models.map(modelItem => (
        <span key={modelItem.model}>{modelItem.model}</span>
      ))}
    </div>
  ),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({ modelProviders: mockContextModelProviders.current }),
}))

type PopupTestProps = Omit<PopupProps, 'inputValue' | 'onInputValueChange'>

function PopupHarness(props: PopupTestProps) {
  const [inputValue, setInputValue] = useState('')

  return (
    <Combobox
      filter={null}
      inputValue={inputValue}
      open
      onInputValueChange={(newInputValue, details) => {
        if (details.reason !== 'item-press')
          setInputValue(newInputValue)
      }}
    >
      <Popup
        {...props}
        inputValue={inputValue}
        onInputValueChange={setInputValue}
      />
    </Combobox>
  )
}

const renderPopup = (ui: ReactElement<PopupTestProps>) => renderWithSystemFeatures(ui, {
  systemFeatures: { trial_models: mockTrialModels.current as unknown as SystemFeatures['trial_models'] },
})

const mockTrialCredits = vi.hoisted(() => ({
  credits: 200,
  totalCredits: 200,
  isExhausted: false,
  isLoading: false,
  nextCreditResetDate: undefined as number | undefined,
}))
vi.mock('../../provider-added-card/use-trial-credits', () => ({
  useTrialCredits: () => mockTrialCredits,
}))

vi.mock('../../provider-added-card/model-auth-dropdown/credits-exhausted-alert', () => ({
  default: ({ hasApiKeyFallback }: { hasApiKeyFallback: boolean }) => (
    <div data-testid="credits-exhausted-alert" data-has-api-key-fallback={String(hasApiKeyFallback)} />
  ),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return { ...actual, IS_CLOUD_EDITION: true }
})

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

vi.mock('../../utils', async () => {
  const actual = await vi.importActual<typeof import('../../utils')>('../../utils')
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
  label: { en_US: 'Test OpenAI', zh_Hans: 'Test OpenAI' },
  icon_small: { en_US: '', zh_Hans: '' },
  icon_small_dark: { en_US: '', zh_Hans: '' },
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
    mockTrialModels.current = ['test-openai', 'test-anthropic']
    Object.assign(mockTrialCredits, {
      credits: 200,
      totalCredits: 200,
      isExhausted: false,
      isLoading: false,
      nextCreditResetDate: undefined,
    })
  })

  it('should filter models by search and allow clearing search without blurring the input', async () => {
    const user = userEvent.setup()

    renderPopup(
      <PopupHarness
        modelList={[makeModel()]}
        onHide={vi.fn()}
      />,
    )

    expect(screen.getByText('openai'))!.toBeInTheDocument()

    const input = screen.getByPlaceholderText('datasetSettings.form.searchModel')
    await user.click(input)
    await user.keyboard('not-found')
    expect(screen.getByText('No model found for \u201Cnot-found\u201D'))!.toBeInTheDocument()

    const clearButton = screen.getByRole('button', { name: 'common.operation.clear' })
    expect(clearButton)!.toBeInTheDocument()
    await user.click(clearButton)

    expect((input as HTMLInputElement).value).toBe('')
    expect(input).toHaveFocus()
  })

  it('should show matching models when searching by model name', () => {
    renderPopup(
      <PopupHarness
        modelList={[
          makeModel({
            models: [makeModelItem({ model: 'gpt-4', label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' } })],
          }),
          makeModel({
            provider: 'anthropic',
            label: { en_US: 'Anthropic', zh_Hans: 'Anthropic' },
            models: [makeModelItem({ model: 'claude-3', label: { en_US: 'Claude 3', zh_Hans: 'Claude 3' } })],
          }),
        ]}
        onHide={vi.fn()}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText('datasetSettings.form.searchModel'),
      { target: { value: 'claude' } },
    )

    expect(screen.queryByText('openai')).not.toBeInTheDocument()
    expect(screen.getByText('anthropic')).toBeInTheDocument()
    expect(screen.getByText('claude-3')).toBeInTheDocument()
    expect(screen.queryByText('gpt-4')).not.toBeInTheDocument()
    expect(screen.queryByText('No model found for \u201Cclaude\u201D')).not.toBeInTheDocument()
  })

  it('should show empty search placeholder when no provider or model name matches', () => {
    renderPopup(
      <PopupHarness
        modelList={[
          makeModel({
            label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
            models: [
              makeModelItem({ model: 'gpt-4', label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' } }),
            ],
          }),
        ]}
        onHide={vi.fn()}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText('datasetSettings.form.searchModel'),
      { target: { value: 'mistral' } },
    )

    expect(screen.getByText('No model found for \u201Cmistral\u201D'))!.toBeInTheDocument()
    expect(screen.queryByText('openai')).not.toBeInTheDocument()
    expect(screen.queryByText('gpt-4')).not.toBeInTheDocument()
  })

  it('should show all models of a provider when searching by provider label', () => {
    renderPopup(
      <PopupHarness
        modelList={[
          makeModel({
            provider: 'openai',
            label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
            models: [
              makeModelItem({ model: 'gpt-4', label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' } }),
              makeModelItem({ model: 'gpt-4o', label: { en_US: 'GPT-4o', zh_Hans: 'GPT-4o' } }),
            ],
          }),
          makeModel({
            provider: 'anthropic',
            label: { en_US: 'Anthropic', zh_Hans: 'Anthropic' },
            models: [
              makeModelItem({ model: 'claude-3', label: { en_US: 'Claude 3', zh_Hans: 'Claude 3' } }),
            ],
          }),
        ]}
        onHide={vi.fn()}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText('datasetSettings.form.searchModel'),
      { target: { value: 'openai' } },
    )

    expect(screen.getByText('openai'))!.toBeInTheDocument()
    expect(screen.getByText('gpt-4'))!.toBeInTheDocument()
    expect(screen.getByText('gpt-4o'))!.toBeInTheDocument()
    expect(screen.queryByText('anthropic')).not.toBeInTheDocument()
    expect(screen.queryByText('claude-3')).not.toBeInTheDocument()
  })

  it('should fuzzy match provider labels and keep all compatible provider models visible', () => {
    renderPopup(
      <PopupHarness
        modelList={[
          makeModel({
            provider: 'openai',
            label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
            models: [
              makeModelItem({ model: 'gpt-4', label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' } }),
              makeModelItem({ model: 'gpt-4o', label: { en_US: 'GPT-4o', zh_Hans: 'GPT-4o' } }),
            ],
          }),
          makeModel({
            provider: 'anthropic',
            label: { en_US: 'Anthropic', zh_Hans: 'Anthropic' },
            models: [
              makeModelItem({ model: 'claude-3', label: { en_US: 'Claude 3', zh_Hans: 'Claude 3' } }),
            ],
          }),
        ]}
        onHide={vi.fn()}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText('datasetSettings.form.searchModel'),
      { target: { value: 'opnai' } },
    )

    expect(screen.getByText('openai'))!.toBeInTheDocument()
    expect(screen.getByText('gpt-4'))!.toBeInTheDocument()
    expect(screen.getByText('gpt-4o'))!.toBeInTheDocument()
    expect(screen.queryByText('anthropic')).not.toBeInTheDocument()
  })

  it('should match model labels without expanding unmatched provider models', () => {
    renderPopup(
      <PopupHarness
        modelList={[
          makeModel({
            provider: 'openai',
            label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
            models: [
              makeModelItem({ model: 'gpt-4', label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' } }),
            ],
          }),
          makeModel({
            provider: 'anthropic',
            label: { en_US: 'Anthropic', zh_Hans: 'Anthropic' },
            models: [
              makeModelItem({ model: 'claude-3', label: { en_US: 'Claude 3', zh_Hans: 'Claude 3' } }),
              makeModelItem({ model: 'claude-instant', label: { en_US: 'Claude Instant', zh_Hans: 'Claude Instant' } }),
            ],
          }),
        ]}
        onHide={vi.fn()}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText('datasetSettings.form.searchModel'),
      { target: { value: 'claude3' } },
    )

    expect(screen.queryByText('openai')).not.toBeInTheDocument()
    expect(screen.getByText('anthropic'))!.toBeInTheDocument()
    expect(screen.getByText('claude-3'))!.toBeInTheDocument()
    expect(screen.queryByText('claude-instant')).not.toBeInTheDocument()
  })

  it('should match model names without separators', () => {
    renderPopup(
      <PopupHarness
        modelList={[
          makeModel({
            provider: 'langgenius/openai/openai',
            label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
            models: [
              makeModelItem({ model: 'gpt-5.4', label: { en_US: 'gpt-5.4', zh_Hans: 'gpt-5.4' } }),
              makeModelItem({ model: 'gpt-5.4-2026-03-05', label: { en_US: 'gpt-5.4-2026-03-05', zh_Hans: 'gpt-5.4-2026-03-05' } }),
              makeModelItem({ model: 'gpt-5.4-mini', label: { en_US: 'gpt-5.4-mini', zh_Hans: 'gpt-5.4-mini' } }),
              makeModelItem({ model: 'gpt-5.4-nano', label: { en_US: 'gpt-5.4-nano', zh_Hans: 'gpt-5.4-nano' } }),
              makeModelItem({ model: 'gpt-5.3-chat-latest', label: { en_US: 'gpt-5.3-chat-latest', zh_Hans: 'gpt-5.3-chat-latest' } }),
              makeModelItem({ model: 'gpt-5.2', label: { en_US: 'gpt-5.2', zh_Hans: 'gpt-5.2' } }),
              makeModelItem({ model: 'gpt-4.1', label: { en_US: 'gpt-4.1', zh_Hans: 'gpt-4.1' } }),
            ],
          }),
        ]}
        onHide={vi.fn()}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText('datasetSettings.form.searchModel'),
      { target: { value: 'gpt5.4' } },
    )

    expect(screen.getByText('gpt-5.4'))!.toBeInTheDocument()
    expect(screen.getByText('gpt-5.4-2026-03-05'))!.toBeInTheDocument()
    expect(screen.getByText('gpt-5.4-mini'))!.toBeInTheDocument()
    expect(screen.getByText('gpt-5.4-nano'))!.toBeInTheDocument()
    expect(screen.queryByText('gpt-5.3-chat-latest')).not.toBeInTheDocument()
    expect(screen.queryByText('gpt-5.2')).not.toBeInTheDocument()
    expect(screen.queryByText('gpt-4.1')).not.toBeInTheDocument()
  })

  it('should not fuzzy match unrelated providers that share the langgenius namespace', () => {
    renderPopup(
      <PopupHarness
        modelList={[
          makeModel({
            provider: 'langgenius/openai/openai',
            label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
            models: [makeModelItem({ model: 'gpt-5.4', label: { en_US: 'gpt-5.4', zh_Hans: 'gpt-5.4' } })],
          }),
          makeModel({
            provider: 'langgenius/openrouter/openrouter',
            label: { en_US: 'OpenRouter', zh_Hans: 'OpenRouter' },
            models: [makeModelItem({ model: 'openrouter-model', label: { en_US: 'OpenRouter Model', zh_Hans: 'OpenRouter Model' } })],
          }),
          makeModel({
            provider: 'langgenius/openai_api_compatible/openai_api_compatible',
            label: { en_US: 'OpenAI-API-compatible', zh_Hans: 'OpenAI-API-compatible' },
            models: [makeModelItem({ model: 'compatible-model', label: { en_US: 'Compatible Model', zh_Hans: 'Compatible Model' } })],
          }),
        ]}
        onHide={vi.fn()}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText('datasetSettings.form.searchModel'),
      { target: { value: 'openai' } },
    )

    expect(screen.getByText('langgenius/openai/openai'))!.toBeInTheDocument()
    expect(screen.getByText('langgenius/openai_api_compatible/openai_api_compatible'))!.toBeInTheDocument()
    expect(screen.queryByText('langgenius/openrouter/openrouter')).not.toBeInTheDocument()
  })

  it('should fuzzy match provider names without matching every langgenius provider', () => {
    renderPopup(
      <PopupHarness
        modelList={[
          makeModel({
            provider: 'langgenius/zhipuai/zhipuai',
            label: { en_US: 'ZHIPU AI', zh_Hans: '智谱 AI' },
            models: [makeModelItem({ model: 'glm-4.7', label: { en_US: 'GLM-4.7', zh_Hans: 'GLM-4.7' } })],
          }),
          makeModel({
            provider: 'langgenius/gemini/google',
            label: { en_US: 'Gemini', zh_Hans: 'Gemini' },
            models: [makeModelItem({ model: 'gemini-3-flash-preview', label: { en_US: 'gemini-3-flash-preview', zh_Hans: 'gemini-3-flash-preview' } })],
          }),
          makeModel({
            provider: 'langgenius/tongyi/tongyi',
            label: { en_US: 'Tongyi', zh_Hans: '通义' },
            models: [makeModelItem({ model: 'qwen-plus', label: { en_US: 'qwen-plus', zh_Hans: 'qwen-plus' } })],
          }),
        ]}
        onHide={vi.fn()}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText('datasetSettings.form.searchModel'),
      { target: { value: 'gemni' } },
    )

    expect(screen.getByText('langgenius/gemini/google'))!.toBeInTheDocument()
    expect(screen.queryByText('langgenius/zhipuai/zhipuai')).not.toBeInTheDocument()
    expect(screen.queryByText('langgenius/tongyi/tongyi')).not.toBeInTheDocument()
  })

  it('should match by model provider key when model label does not contain the search text', () => {
    renderPopup(
      <PopupHarness
        modelList={[
          makeModel({
            provider: 'azure_openai',
            label: { en_US: 'Azure', zh_Hans: 'Azure' },
            models: [
              makeModelItem({ model: 'gpt-4', label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' } }),
            ],
          }),
        ]}
        onHide={vi.fn()}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText('datasetSettings.form.searchModel'),
      { target: { value: 'openai' } },
    )

    expect(screen.getByText('azure_openai'))!.toBeInTheDocument()
    expect(screen.getByText('gpt-4'))!.toBeInTheDocument()
  })

  it('should still apply scope features when matching by provider label', () => {
    mockSupportFunctionCall.mockReturnValue(false)

    renderPopup(
      <PopupHarness
        modelList={[
          makeModel({
            provider: 'openai',
            label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
            models: [
              makeModelItem({ model: 'gpt-4', features: [ModelFeatureEnum.vision] }),
              makeModelItem({ model: 'gpt-4-tool', features: [ModelFeatureEnum.toolCall] }),
            ],
          }),
        ]}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.toolCall]}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText('datasetSettings.form.searchModel'),
      { target: { value: 'openai' } },
    )

    expect(screen.getByText('No model found for \u201Copenai\u201D'))!.toBeInTheDocument()
    expect(screen.queryByText('gpt-4')).not.toBeInTheDocument()
    expect(screen.queryByText('gpt-4-tool')).not.toBeInTheDocument()
  })

  it('should not show compatible-only helper text when no scope features are applied', () => {
    renderPopup(
      <PopupHarness
        modelList={[makeModel()]}
        onHide={vi.fn()}
      />,
    )

    expect(screen.queryByText('common.modelProvider.selector.onlyCompatibleModelsShown')).not.toBeInTheDocument()
  })

  it('should show compatible-only helper text when scope features are applied', () => {
    renderPopup(
      <PopupHarness
        modelList={[makeModel()]}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.vision]}
      />,
    )

    expect(screen.getByTestId('compatible-models-banner'))!.toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.selector.onlyCompatibleModelsShown'))!.toBeInTheDocument()
  })

  it('should keep search and footer outside the scrollable model list', () => {
    renderPopup(
      <PopupHarness
        modelList={[makeModel()]}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.vision]}
      />,
    )

    const scrollRegion = screen.getByRole('region', { name: 'common.modelProvider.models' })
    const searchInput = screen.getByPlaceholderText('datasetSettings.form.searchModel')
    const settingsButton = screen.getByRole('button', { name: /common\.modelProvider\.selector\.modelProviderSettings/ })

    expect(scrollRegion)!.toBeInTheDocument()
    expect(scrollRegion).not.toContainElement(searchInput)
    expect(scrollRegion).not.toContainElement(settingsButton)
    expect(scrollRegion).toContainElement(screen.getByTestId('compatible-models-banner'))
  })

  it('should filter by scope features including toolCall and non-toolCall checks', () => {
    const modelList = [
      makeModel({ models: [makeModelItem({ features: [ModelFeatureEnum.toolCall, ModelFeatureEnum.vision] })] }),
    ]

    mockSupportFunctionCall.mockReturnValue(false)
    const { unmount } = renderPopup(
      <PopupHarness
        modelList={modelList}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.toolCall, ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('No model found for \u201C\u201D'))!.toBeInTheDocument()

    unmount()
    mockSupportFunctionCall.mockReturnValue(true)
    const { unmount: unmount2 } = renderPopup(
      <PopupHarness
        modelList={modelList}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.toolCall, ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('openai'))!.toBeInTheDocument()

    unmount2()
    const { unmount: unmount3 } = renderPopup(
      <PopupHarness
        modelList={modelList}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('openai'))!.toBeInTheDocument()

    unmount3()
    renderPopup(
      <PopupHarness
        modelList={[makeModel({ models: [makeModelItem({ features: undefined })] })]}
        onHide={vi.fn()}
        scopeFeatures={[ModelFeatureEnum.vision]}
      />,
    )
    expect(screen.getByText('No model found for \u201C\u201D'))!.toBeInTheDocument()
  })

  it('should match model labels from fallback languages when current language key is missing', () => {
    mockLanguage = 'fr_FR'

    renderPopup(
      <PopupHarness
        modelList={[
          makeModel({
            models: [
              makeModelItem({
                label: { en_US: 'OpenAI GPT', zh_Hans: 'OpenAI GPT' },
              }),
            ],
          }),
        ]}
        onHide={vi.fn()}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText('datasetSettings.form.searchModel'),
      { target: { value: 'openai' } },
    )

    expect(screen.getByText('openai'))!.toBeInTheDocument()
  })

  it('should show credits exhausted alert when an exhausted provider supports credits', () => {
    Object.assign(mockTrialCredits, {
      credits: 0,
      totalCredits: 200,
      isExhausted: true,
    })
    mockContextModelProviders.current = [
      makeContextProvider({
        provider: 'test-openai',
        system_configuration: {
          enabled: true,
        } as MockContextProvider['system_configuration'],
      }),
    ]

    renderPopup(
      <PopupHarness
        modelList={[makeModel()]}
        onHide={vi.fn()}
      />,
    )

    expect(screen.getByTestId('credits-exhausted-alert'))!.toHaveAttribute('data-has-api-key-fallback', 'false')
  })

  it('should not show credits exhausted alert when only non-trial system providers are exhausted', () => {
    Object.assign(mockTrialCredits, {
      credits: 0,
      totalCredits: 200,
      isExhausted: true,
    })
    mockTrialModels.current = ['test-anthropic']
    mockContextModelProviders.current = [
      makeContextProvider({
        provider: 'test-openai',
        system_configuration: {
          enabled: true,
        } as MockContextProvider['system_configuration'],
      }),
    ]

    renderPopup(
      <PopupHarness
        modelList={[makeModel()]}
        onHide={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('credits-exhausted-alert')).not.toBeInTheDocument()
  })

  it('should not mark api key fallback for non-trial system providers', () => {
    Object.assign(mockTrialCredits, {
      credits: 0,
      totalCredits: 200,
      isExhausted: true,
    })
    mockTrialModels.current = ['test-anthropic']
    mockContextModelProviders.current = [
      makeContextProvider({
        provider: 'test-openai',
        custom_configuration: {
          status: 'active',
        } as MockContextProvider['custom_configuration'],
        system_configuration: {
          enabled: true,
        } as MockContextProvider['system_configuration'],
      }),
    ]

    renderPopup(
      <PopupHarness
        modelList={[makeModel()]}
        onHide={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('credits-exhausted-alert')).not.toBeInTheDocument()
  })

  it('should open provider settings when clicking footer link', () => {
    const onHide = vi.fn()
    renderPopup(
      <PopupHarness
        modelList={[makeModel()]}
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
    renderPopup(
      <PopupHarness
        modelList={[]}
        onHide={onHide}
      />,
    )

    expect(screen.getByText(/modelProvider\.selector\.noProviderConfigured(?!Desc)/))!.toBeInTheDocument()
    expect(screen.getByText(/modelProvider\.selector\.noProviderConfiguredDesc/))!.toBeInTheDocument()

    fireEvent.click(screen.getByText(/modelProvider\.selector\.configure/))
    expect(onHide).toHaveBeenCalled()
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
      payload: 'provider',
    })
  })

  it('should render marketplace providers that are not installed', () => {
    mockContextModelProviders.current = [makeContextProvider({ provider: 'test-openai' })]

    renderPopup(
      <PopupHarness
        modelList={[]}
        onHide={vi.fn()}
      />,
    )

    expect(screen.queryByText('TestOpenAI')).not.toBeInTheDocument()
    expect(screen.getByText('TestAnthropic'))!.toBeInTheDocument()
    expect(screen.getByText(/modelProvider\.selector\.fromMarketplace/))!.toBeInTheDocument()
    expect(screen.getByText(/modelProvider\.selector\.discoverMoreInMarketplace/))!.toBeInTheDocument()
  })

  it('should show installed marketplace providers without models when AI credits are available', () => {
    mockContextModelProviders.current = [makeContextProvider({
      provider: 'test-anthropic',
      system_configuration: {
        enabled: true,
      } as MockContextProvider['system_configuration'],
    })]

    renderPopup(
      <PopupHarness
        modelList={[]}
        onHide={vi.fn()}
      />,
    )

    expect(screen.getByText('test-anthropic'))!.toBeInTheDocument()
    expect(screen.getByText('TestOpenAI'))!.toBeInTheDocument()
  })

  it('should hide installed marketplace providers without models when AI credits are exhausted', () => {
    Object.assign(mockTrialCredits, {
      credits: 0,
      totalCredits: 200,
      isExhausted: true,
    })
    mockContextModelProviders.current = [makeContextProvider({
      provider: 'test-anthropic',
      system_configuration: {
        enabled: true,
      } as MockContextProvider['system_configuration'],
    })]

    renderPopup(
      <PopupHarness
        modelList={[]}
        onHide={vi.fn()}
      />,
    )

    expect(screen.queryByText('test-anthropic')).not.toBeInTheDocument()
    expect(screen.queryByText('TestAnthropic')).not.toBeInTheDocument()
    expect(screen.getByText('TestOpenAI'))!.toBeInTheDocument()
  })

  it('should toggle marketplace section collapse', () => {
    renderPopup(
      <PopupHarness
        modelList={[]}
        onHide={vi.fn()}
      />,
    )

    expect(screen.getByText('TestOpenAI'))!.toBeInTheDocument()

    fireEvent.click(screen.getByText(/modelProvider\.selector\.fromMarketplace/))

    expect(screen.queryByText('TestOpenAI')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(/modelProvider\.selector\.fromMarketplace/))

    expect(screen.getByText('TestOpenAI'))!.toBeInTheDocument()
  })

  it('should install plugin when clicking install button', async () => {
    mockMarketplacePlugins.current = [
      { plugin_id: 'langgenius/openai', latest_package_identifier: 'langgenius/openai:1.0.0' },
    ]
    mockInstallMutateAsync.mockResolvedValue({ all_installed: true, task_id: 'task-1' })

    renderPopup(
      <PopupHarness
        modelList={[]}
        onHide={vi.fn()}
      />,
    )

    const installButtons = screen.getAllByText(/common\.modelProvider\.selector\.install/)
    fireEvent.click(installButtons[0]!)

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

    renderPopup(
      <PopupHarness
        modelList={[]}
        onHide={vi.fn()}
      />,
    )

    const installButtons = screen.getAllByText(/common\.modelProvider\.selector\.install/)
    fireEvent.click(installButtons[0]!)

    await waitFor(() => {
      expect(mockInstallMutateAsync).toHaveBeenCalled()
    })

    expect(screen.getAllByText(/common\.modelProvider\.selector\.install/).length).toBeGreaterThan(0)
  })

  it('should run checkTaskStatus when not all_installed', async () => {
    mockMarketplacePlugins.current = [
      { plugin_id: 'langgenius/openai', latest_package_identifier: 'langgenius/openai:1.0.0' },
    ]
    mockInstallMutateAsync.mockResolvedValue({ all_installed: false, task_id: 'task-1' })
    mockCheck.mockResolvedValue(undefined)

    renderPopup(
      <PopupHarness
        modelList={[]}
        onHide={vi.fn()}
      />,
    )

    const installButtons = screen.getAllByText(/common\.modelProvider\.selector\.install/)
    fireEvent.click(installButtons[0]!)

    await waitFor(() => {
      expect(mockCheck).toHaveBeenCalledWith({
        taskId: 'task-1',
        pluginUniqueIdentifier: 'langgenius/openai:1.0.0',
      })
    })
    expect(mockRefreshPluginList).toHaveBeenCalled()
  })

  it('should skip install requests when marketplace plugins are still loading', async () => {
    mockMarketplacePlugins.current = [
      { plugin_id: 'langgenius/openai', latest_package_identifier: 'langgenius/openai:1.0.0' },
    ]
    mockMarketplacePlugins.isLoading = true

    renderPopup(
      <PopupHarness
        modelList={[]}
        onHide={vi.fn()}
      />,
    )

    fireEvent.click(screen.getAllByText(/common\.modelProvider\.selector\.install/)[0]!)

    await waitFor(() => {
      expect(mockInstallMutateAsync).not.toHaveBeenCalled()
    })
  })

  it('should skip install requests when the marketplace plugin cannot be found', async () => {
    mockMarketplacePlugins.current = []

    renderPopup(
      <PopupHarness
        modelList={[]}
        onHide={vi.fn()}
      />,
    )

    fireEvent.click(screen.getAllByText(/common\.modelProvider\.selector\.install/)[0]!)

    await waitFor(() => {
      expect(mockInstallMutateAsync).not.toHaveBeenCalled()
    })
  })

  it('should sort the selected provider to the top when a default model is provided', () => {
    renderPopup(
      <PopupHarness
        defaultModel={{ provider: 'anthropic', model: 'claude-3' }}
        modelList={[
          makeModel({ provider: 'openai', label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' } }),
          makeModel({ provider: 'anthropic', label: { en_US: 'Anthropic', zh_Hans: 'Anthropic' } }),
        ]}
        onHide={vi.fn()}
      />,
    )

    const providerLabels = screen.getAllByText(/openai|anthropic/)
    expect(providerLabels[0])!.toHaveTextContent('anthropic')
  })
})
