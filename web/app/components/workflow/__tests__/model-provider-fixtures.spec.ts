import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  ModelStatusEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  createCredentialState,
  createDefaultModel,
  createModel,
  createModelItem,
  createProviderMeta,
} from './model-provider-fixtures'

describe('model-provider-fixtures', () => {
  describe('createModelItem', () => {
    it('should return the default text embedding model item', () => {
      expect(createModelItem()).toEqual({
        model: 'text-embedding-3-large',
        label: { en_US: 'Text Embedding 3 Large', zh_Hans: 'Text Embedding 3 Large' },
        model_type: ModelTypeEnum.textEmbedding,
        fetch_from: ConfigurationMethodEnum.predefinedModel,
        status: ModelStatusEnum.active,
        model_properties: {},
        load_balancing_enabled: false,
      })
    })

    it('should allow overriding the default model item fields', () => {
      expect(createModelItem({
        model: 'bge-large',
        status: ModelStatusEnum.disabled,
        load_balancing_enabled: true,
      })).toEqual(expect.objectContaining({
        model: 'bge-large',
        status: ModelStatusEnum.disabled,
        load_balancing_enabled: true,
      }))
    })
  })

  describe('createModel', () => {
    it('should build an active provider model with one default model item', () => {
      const result = createModel()

      expect(result.provider).toBe('openai')
      expect(result.status).toBe(ModelStatusEnum.active)
      expect(result.models).toHaveLength(1)
      expect(result.models[0]).toEqual(createModelItem())
    })

    it('should use override values for provider metadata and model list', () => {
      const customModelItem = createModelItem({
        model: 'rerank-v1',
        model_type: ModelTypeEnum.rerank,
      })

      expect(createModel({
        provider: 'cohere',
        label: { en_US: 'Cohere', zh_Hans: 'Cohere' },
        models: [customModelItem],
      })).toEqual(expect.objectContaining({
        provider: 'cohere',
        label: { en_US: 'Cohere', zh_Hans: 'Cohere' },
        models: [customModelItem],
      }))
    })
  })

  describe('createDefaultModel', () => {
    it('should return the default provider and model selection', () => {
      expect(createDefaultModel()).toEqual({
        provider: 'openai',
        model: 'text-embedding-3-large',
      })
    })

    it('should allow overriding the default provider selection', () => {
      expect(createDefaultModel({
        provider: 'azure_openai',
        model: 'text-embedding-3-small',
      })).toEqual({
        provider: 'azure_openai',
        model: 'text-embedding-3-small',
      })
    })
  })

  describe('createProviderMeta', () => {
    it('should return provider metadata with credential and system configuration defaults', () => {
      expect(createProviderMeta()).toEqual({
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
      })
    })

    it('should apply provider metadata overrides', () => {
      expect(createProviderMeta({
        provider: 'bedrock',
        supported_model_types: [ModelTypeEnum.textGeneration],
        preferred_provider_type: PreferredProviderTypeEnum.system,
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.paid,
          quota_configurations: [],
        },
      })).toEqual(expect.objectContaining({
        provider: 'bedrock',
        supported_model_types: [ModelTypeEnum.textGeneration],
        preferred_provider_type: PreferredProviderTypeEnum.system,
        system_configuration: {
          enabled: false,
          current_quota_type: CurrentSystemQuotaTypeEnum.paid,
          quota_configurations: [],
        },
      }))
    })
  })

  describe('createCredentialState', () => {
    it('should return the default active credential panel state', () => {
      expect(createCredentialState()).toEqual({
        variant: 'api-active',
        priority: 'apiKeyOnly',
        supportsCredits: false,
        showPrioritySwitcher: false,
        isCreditsExhausted: false,
        hasCredentials: true,
        credentialName: undefined,
        credits: 0,
      })
    })

    it('should allow overriding the credential panel state', () => {
      expect(createCredentialState({
        variant: 'credits-active',
        supportsCredits: true,
        showPrioritySwitcher: true,
        credits: 12,
        credentialName: 'Primary Key',
      })).toEqual(expect.objectContaining({
        variant: 'credits-active',
        supportsCredits: true,
        showPrioritySwitcher: true,
        credits: 12,
        credentialName: 'Primary Key',
      }))
    })
  })
})
