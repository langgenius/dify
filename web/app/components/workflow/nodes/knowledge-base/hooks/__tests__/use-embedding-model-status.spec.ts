import type {
  Model,
  ModelItem,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CredentialPanelState } from '@/app/components/header/account-setting/model-provider-page/provider-added-card/use-credential-panel-state'
import { renderHook } from '@testing-library/react'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  ModelStatusEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useEmbeddingModelStatus } from '../use-embedding-model-status'

const mockUseCredentialPanelState = vi.hoisted(() => vi.fn())
const mockUseProviderContext = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/header/account-setting/model-provider-page/provider-added-card/use-credential-panel-state', () => ({
  useCredentialPanelState: mockUseCredentialPanelState,
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: mockUseProviderContext,
}))

const createModelItem = (overrides: Partial<ModelItem> = {}): ModelItem => ({
  model: 'text-embedding-3-large',
  label: { en_US: 'Text Embedding 3 Large', zh_Hans: 'Text Embedding 3 Large' },
  model_type: ModelTypeEnum.textEmbedding,
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: {},
  load_balancing_enabled: false,
  ...overrides,
})

const createModel = (overrides: Partial<Model> = {}): Model => ({
  provider: 'openai',
  icon_small: { en_US: 'icon', zh_Hans: 'icon' },
  icon_small_dark: { en_US: 'icon-dark', zh_Hans: 'icon-dark' },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  models: [createModelItem()],
  status: ModelStatusEnum.active,
  ...overrides,
})

const createProviderMeta = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  provider: 'openai',
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  help: {
    title: { en_US: 'Help', zh_Hans: 'Help' },
    url: { en_US: 'https://example.com/help', zh_Hans: 'https://example.com/help' },
  },
  icon_small: { en_US: 'icon', zh_Hans: 'icon' },
  icon_small_dark: { en_US: 'icon-dark', zh_Hans: 'icon-dark' },
  supported_model_types: [ModelTypeEnum.textEmbedding],
  configurate_methods: [ConfigurationMethodEnum.predefinedModel],
  provider_credential_schema: {
    credential_form_schemas: [],
  },
  model_credential_schema: {
    model: {
      label: { en_US: 'Model', zh_Hans: 'Model' },
      placeholder: { en_US: 'Select model', zh_Hans: 'Select model' },
    },
    credential_form_schemas: [],
  },
  preferred_provider_type: PreferredProviderTypeEnum.custom,
  custom_configuration: {
    status: CustomConfigurationStatusEnum.active,
  },
  system_configuration: {
    enabled: true,
    current_quota_type: CurrentSystemQuotaTypeEnum.free,
    quota_configurations: [],
  },
  ...overrides,
})

const createCredentialState = (overrides: Partial<CredentialPanelState> = {}): CredentialPanelState => ({
  variant: 'api-active',
  priority: 'apiKeyOnly',
  supportsCredits: false,
  showPrioritySwitcher: false,
  isCreditsExhausted: false,
  hasCredentials: true,
  credentialName: undefined,
  credits: 0,
  ...overrides,
})

describe('useEmbeddingModelStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProviderContext.mockReturnValue({
      modelProviders: [createProviderMeta()],
    })
    mockUseCredentialPanelState.mockReturnValue(createCredentialState())
  })

  // The hook should resolve provider and model metadata before deriving the final status.
  describe('Resolution', () => {
    it('should return the matched provider, current model, and active status', () => {
      const embeddingModelList = [createModel()]

      const { result } = renderHook(() => useEmbeddingModelStatus({
        embeddingModel: 'text-embedding-3-large',
        embeddingModelProvider: 'openai',
        embeddingModelList,
      }))

      expect(result.current.providerMeta?.provider).toBe('openai')
      expect(result.current.modelProvider?.provider).toBe('openai')
      expect(result.current.currentModel?.model).toBe('text-embedding-3-large')
      expect(result.current.status).toBe('active')
    })

    it('should return incompatible when the provider exists but the selected model is missing', () => {
      const embeddingModelList = [
        createModel({
          models: [createModelItem({ model: 'another-model' })],
        }),
      ]

      const { result } = renderHook(() => useEmbeddingModelStatus({
        embeddingModel: 'text-embedding-3-large',
        embeddingModelProvider: 'openai',
        embeddingModelList,
      }))

      expect(result.current.providerMeta?.provider).toBe('openai')
      expect(result.current.currentModel).toBeUndefined()
      expect(result.current.status).toBe('incompatible')
    })

    it('should return empty when no embedding model is configured', () => {
      const { result } = renderHook(() => useEmbeddingModelStatus({
        embeddingModel: undefined,
        embeddingModelProvider: undefined,
        embeddingModelList: [],
      }))

      expect(result.current.providerMeta).toBeUndefined()
      expect(result.current.modelProvider).toBeUndefined()
      expect(result.current.currentModel).toBeUndefined()
      expect(result.current.status).toBe('empty')
    })
  })
})
