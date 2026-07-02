import type { Model, ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'

type ProviderModelCompatibility = {
  providers: string[]
  incompatibleModels: RegExp[]
}

const agentIncompatibleModelConfig: ProviderModelCompatibility[] = [
  {
    providers: ['openai'],
    incompatibleModels: [
      /^chatgpt-/i,
      /^gpt-4/i,
      /^gpt-3/i,
      /^o[34]-mini(?:-|$)/i,
    ],
  },
  {
    providers: ['anthropic'],
    incompatibleModels: [
      /^claude-3/i,
    ],
  },
  {
    providers: ['gemini', 'google'],
    incompatibleModels: [
      /^gemini-2[.-][05]-flash(?:-lite)?(?:-|$)/i,
      /^gemini-1[.-]5-flash(?:-8b)?(?:-|$)/i,
      /^Nano/i,
    ],
  },
  {
    providers: ['x'],
    incompatibleModels: [
      /^grok-code-/i,
      /^grok-(?:2|3)/i,
    ],
  },
  {
    providers: ['deepseek'],
    incompatibleModels: [
      /^deepseek-(?:chat|coder|reasoner)(?:-|$)/i,
    ],
  },
  {
    providers: ['minimax'],
    incompatibleModels: [
      /^minimax-text-01$/i,
      /^minimax-m1$/i,
    ],
  },
  {
    providers: ['tongyi', 'qwen'],
    incompatibleModels: [
      /^qwen2/i,
      /^qwen-flash/i,
    ],
  },
  {
    providers: ['chatglm', 'zhipuai'],
    incompatibleModels: [
      /^chatglm-(?:2|3)/i,
      /^glm-4-(?:air|airx|flash)$/i,
      /^glm-z1-(?:air|flash)$/i,
    ],
  },
]

const normalizeProviderName = (provider: string) => provider.split('/').at(-1)?.toLowerCase() ?? provider.toLowerCase()

export function isAgentCompatibleModel(provider: Model, modelItem: ModelItem) {
  const providerName = normalizeProviderName(provider.provider)
  const providerConfig = agentIncompatibleModelConfig.find(config => config.providers.includes(providerName))

  if (!providerConfig)
    return true

  return !providerConfig.incompatibleModels.some(pattern => pattern.test(modelItem.model))
}
