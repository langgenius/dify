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

const createModelItem = (model: string, overrides: Partial<ModelItem> = {}): ModelItem => ({
  model,
  label: { en_US: model, zh_Hans: model },
  model_type: ModelTypeEnum.textGeneration,
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: {},
  load_balancing_enabled: false,
  ...overrides,
})

describe('isAgentCompatibleModel', () => {
  it('should reject configured OpenAI models below the Agent-compatible baseline', () => {
    const provider = createModel('langgenius/openai/openai')

    expect(isAgentCompatibleModel(provider, createModelItem('gpt-4o-mini'))).toBe(false)
    expect(isAgentCompatibleModel(provider, createModelItem('chatgpt-4o-latest'))).toBe(false)
    expect(isAgentCompatibleModel(provider, createModelItem('gpt-4.1-mini'))).toBe(false)
    expect(isAgentCompatibleModel(provider, createModelItem('gpt-4.1-nano'))).toBe(false)
    expect(isAgentCompatibleModel(provider, createModelItem('gpt-4o'))).toBe(false)
    expect(isAgentCompatibleModel(provider, createModelItem('gpt-4.1'))).toBe(false)
    expect(isAgentCompatibleModel(provider, createModelItem('gpt-4'))).toBe(false)
    expect(isAgentCompatibleModel(provider, createModelItem('gpt-4-turbo'))).toBe(false)
    expect(isAgentCompatibleModel(provider, createModelItem('gpt-4-vision-preview'))).toBe(false)
    expect(isAgentCompatibleModel(provider, createModelItem('gpt-3.5-turbo-16k'))).toBe(false)
    expect(isAgentCompatibleModel(provider, createModelItem('o3-mini'))).toBe(false)
    expect(isAgentCompatibleModel(provider, createModelItem('o4-mini'))).toBe(false)
  })

  it('should allow newer OpenAI models and other providers', () => {
    expect(isAgentCompatibleModel(createModel('openai'), createModelItem('gpt-5'))).toBe(true)
    expect(isAgentCompatibleModel(createModel('anthropic'), createModelItem('other-model'))).toBe(true)
  })

  it('should reject specifically configured models that do not meet the Agent baseline', () => {
    expect(isAgentCompatibleModel(createModel('anthropic'), createModelItem('claude-3-haiku-20240307'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('anthropic'), createModelItem('claude-3.5-sonnet-20241022'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('langgenius/gemini/google'), createModelItem('gemini-2.5-flash-lite'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('langgenius/gemini/google'), createModelItem('gemini-1.5-flash-8b'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('deepseek'), createModelItem('deepseek-chat'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('deepseek'), createModelItem('deepseek-coder'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('deepseek'), createModelItem('deepseek-reasoner'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('deepseek'), createModelItem('deepseek-chat-v3'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('minimax'), createModelItem('minimax-text-01'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('minimax'), createModelItem('minimax-m1'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('tongyi'), createModelItem('qwen2.5-72b-instruct'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('tongyi'), createModelItem('qwen2.5-coder-32b-instruct'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('tongyi'), createModelItem('qwen-flash'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('langgenius/zhipuai/zhipuai'), createModelItem('glm-4-airx'))).toBe(false)
    expect(isAgentCompatibleModel(createModel('langgenius/zhipuai/zhipuai'), createModelItem('glm-z1-flash'))).toBe(false)
  })

  it('should allow unconfigured models from the same providers', () => {
    expect(isAgentCompatibleModel(createModel('anthropic'), createModelItem('claude-sonnet-4'))).toBe(true)
    expect(isAgentCompatibleModel(createModel('langgenius/gemini/google'), createModelItem('gemini-2.5-pro'))).toBe(true)
    expect(isAgentCompatibleModel(createModel('deepseek'), createModelItem('deepseek-r1-distill-qwen-32b'))).toBe(true)
    expect(isAgentCompatibleModel(createModel('tongyi'), createModelItem('qwen3-coder-plus'))).toBe(true)
    expect(isAgentCompatibleModel(createModel('langgenius/zhipuai/zhipuai'), createModelItem('glm-4.7'))).toBe(true)
  })
})
