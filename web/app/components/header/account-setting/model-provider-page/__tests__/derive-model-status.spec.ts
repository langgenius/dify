import type { Model, ModelItem, ModelProvider } from '../declarations'
import type { CredentialPanelState } from '../provider-added-card/use-credential-panel-state'
import {
  ConfigurationMethodEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../declarations'
import { deriveModelStatus } from '../derive-model-status'

const createCredentialState = (overrides: Partial<CredentialPanelState> = {}): CredentialPanelState => ({
  variant: 'credits-active',
  priority: 'credits',
  supportsCredits: true,
  showPrioritySwitcher: true,
  hasCredentials: false,
  isCreditsExhausted: false,
  credentialName: undefined,
  credits: 100,
  ...overrides,
})

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

const createModelProvider = (): ModelProvider =>
  ({ provider: 'openai' } as ModelProvider)

const createModel = (overrides: Partial<Model> = {}): Model => ({
  provider: 'openai',
  icon_small: { en_US: '', zh_Hans: '' },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  models: [createModelItem()],
  status: ModelStatusEnum.active,
  ...overrides,
})

describe('deriveModelStatus', () => {
  it('should return empty when model id or provider name is missing', () => {
    expect(
      deriveModelStatus('', 'openai', createModelProvider(), createModelItem(), createCredentialState()),
    ).toBe('empty')
    expect(
      deriveModelStatus('text-embedding-3-large', '', createModelProvider(), createModelItem(), createCredentialState()),
    ).toBe('empty')
  })

  it('should return incompatible when provider plugin is missing', () => {
    expect(
      deriveModelStatus('text-embedding-3-large', 'openai', undefined, createModelItem(), createCredentialState()),
    ).toBe('incompatible')
  })

  it('should return incompatible when model is missing from the provider list', () => {
    expect(
      deriveModelStatus('text-embedding-3-large', 'openai', createModel(), undefined, createCredentialState()),
    ).toBe('incompatible')
  })

  it('should return credits-exhausted when model is missing and AI credits are exhausted without api key', () => {
    expect(
      deriveModelStatus(
        'text-embedding-3-large',
        'openai',
        createModelProvider(),
        undefined,
        createCredentialState({
          priority: 'apiKey',
          hasCredentials: false,
          isCreditsExhausted: true,
        }),
      ),
    ).toBe('credits-exhausted')
  })

  it('should return configure-required when the model status is no-configure', () => {
    expect(
      deriveModelStatus('text-embedding-3-large', 'openai', createModelProvider(), createModelItem({ status: ModelStatusEnum.noConfigure }), createCredentialState()),
    ).toBe('configure-required')
  })

  it('should return disabled when the model status is disabled', () => {
    expect(
      deriveModelStatus('text-embedding-3-large', 'openai', createModelProvider(), createModelItem({ status: ModelStatusEnum.disabled }), createCredentialState()),
    ).toBe('disabled')
  })

  it('should return credits-exhausted when credential state takes priority', () => {
    expect(
      deriveModelStatus(
        'text-embedding-3-large',
        'openai',
        createModelProvider(),
        createModelItem(),
        createCredentialState({ isCreditsExhausted: true }),
      ),
    ).toBe('credits-exhausted')
  })

  it('should return api-key-unavailable when credential state is api-unavailable', () => {
    expect(
      deriveModelStatus(
        'text-embedding-3-large',
        'openai',
        createModelProvider(),
        createModelItem(),
        createCredentialState({ variant: 'api-unavailable', priority: 'apiKey' }),
      ),
    ).toBe('api-key-unavailable')
  })

  it('should return credits-exhausted when model status is quota exceeded', () => {
    expect(
      deriveModelStatus(
        'text-embedding-3-large',
        'openai',
        createModelProvider(),
        createModelItem({ status: ModelStatusEnum.quotaExceeded }),
        createCredentialState({ priority: 'apiKey' }),
      ),
    ).toBe('credits-exhausted')
  })

  it('should return api-key-unavailable when model status is credential removed', () => {
    expect(
      deriveModelStatus(
        'text-embedding-3-large',
        'openai',
        createModelProvider(),
        createModelItem({ status: ModelStatusEnum.credentialRemoved }),
        createCredentialState({ priority: 'apiKey' }),
      ),
    ).toBe('api-key-unavailable')
  })

  it('should return incompatible when model status is no-permission', () => {
    expect(
      deriveModelStatus(
        'text-embedding-3-large',
        'openai',
        createModelProvider(),
        createModelItem({ status: ModelStatusEnum.noPermission }),
        createCredentialState({ priority: 'apiKey' }),
      ),
    ).toBe('incompatible')
  })

  it('should return active when model and credential state are available', () => {
    expect(
      deriveModelStatus('text-embedding-3-large', 'openai', createModelProvider(), createModelItem(), createCredentialState()),
    ).toBe('active')
  })
})
