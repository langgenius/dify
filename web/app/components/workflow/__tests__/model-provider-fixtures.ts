import type {
  DefaultModel,
  Model,
  ModelItem,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CredentialPanelState } from '@/app/components/header/account-setting/model-provider-page/provider-added-card/use-credential-panel-state'
import {
  ConfigurationMethodEnum,
  CurrentSystemQuotaTypeEnum,
  CustomConfigurationStatusEnum,
  ModelStatusEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'

export function createModelItem(overrides: Partial<ModelItem> = {}): ModelItem {
  return {
    model: 'text-embedding-3-large',
    label: { en_US: 'Text Embedding 3 Large', zh_Hans: 'Text Embedding 3 Large' },
    model_type: ModelTypeEnum.textEmbedding,
    fetch_from: ConfigurationMethodEnum.predefinedModel,
    status: ModelStatusEnum.active,
    model_properties: {},
    load_balancing_enabled: false,
    ...overrides,
  }
}

export function createModel(overrides: Partial<Model> = {}): Model {
  return {
    provider: 'openai',
    icon_small: { en_US: 'icon', zh_Hans: 'icon' },
    icon_small_dark: { en_US: 'icon-dark', zh_Hans: 'icon-dark' },
    label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
    models: [createModelItem()],
    status: ModelStatusEnum.active,
    ...overrides,
  }
}

export function createDefaultModel(overrides: Partial<DefaultModel> = {}): DefaultModel {
  return {
    provider: 'openai',
    model: 'text-embedding-3-large',
    ...overrides,
  }
}

export function createProviderMeta(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
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
  }
}

export function createCredentialState(overrides: Partial<CredentialPanelState> = {}): CredentialPanelState {
  return {
    variant: 'api-active',
    priority: 'apiKeyOnly',
    supportsCredits: false,
    showPrioritySwitcher: false,
    isCreditsExhausted: false,
    hasCredentials: true,
    credentialName: undefined,
    credits: 0,
    ...overrides,
  }
}
