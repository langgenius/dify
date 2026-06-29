import type { Model, ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  ConfigurationMethodEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { isAgentCompatibleModel } from '../model-compatibility'

const createModel = (provider: string): Model => ({
  provider,
  icon_small: { en_US: '', zh_Hans: '' },
  label: { en_US: provider, zh_Hans: provider },
  models: [],
  status: ModelStatusEnum.active,
})

const createModelItem = (model: string): ModelItem => ({
  model,
  label: { en_US: model, zh_Hans: model },
  model_type: ModelTypeEnum.textGeneration,
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: {},
  load_balancing_enabled: false,
})

describe('isAgentCompatibleModel', () => {
  it('should reject configured OpenAI models below the Agent-compatible baseline', () => {
    const provider = createModel('langgenius/openai/openai')

    expect(isAgentCompatibleModel(provider, createModelItem('gpt-4'))).toBe(false)
    expect(isAgentCompatibleModel(provider, createModelItem('gpt-4-vision-preview'))).toBe(false)
    expect(isAgentCompatibleModel(provider, createModelItem('gpt-3.5-turbo-16k'))).toBe(false)
  })

  it('should allow newer OpenAI models and other providers', () => {
    expect(isAgentCompatibleModel(createModel('openai'), createModelItem('gpt-4o'))).toBe(true)
    expect(isAgentCompatibleModel(createModel('openai'), createModelItem('gpt-4.1'))).toBe(true)
    expect(isAgentCompatibleModel(createModel('anthropic'), createModelItem('claude-3.5-sonnet'))).toBe(true)
  })
})
