import type { Model, ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'

type ProviderModelCompatibility = {
  providers: string[]
  incompatibleModels: RegExp[]
}

const agentIncompatibleModelConfig: ProviderModelCompatibility[] = [
  {
    providers: ['openai'],
    incompatibleModels: [
      /^gpt-4o-mini(?:-|$)/i,
      /^gpt-4\.1-(?:mini|nano)(?:-|$)/i,
      /^gpt-4(?:-|$)/i,
      /^gpt-3\.5/i,
      /^o[34]-mini(?:-|$)/i,
    ],
  },
  {
    providers: ['anthropic'],
    incompatibleModels: [
      /^claude-3-(?:haiku|sonnet|opus)(?:-|$)/i,
      /^claude-3(?:\.5|-5)-(?:haiku|sonnet)(?:-|$)/i,
    ],
  },
  {
    providers: ['gemini', 'google'],
    incompatibleModels: [
      /^gemini-2[.-][05]-flash(?:-lite)?(?:-|$)/i,
      /^gemini-1[.-]5-flash(?:-8b)?(?:-|$)/i,
    ],
  },
  {
    providers: ['deepseek'],
    incompatibleModels: [
      /^deepseek-r1$/i,
      /^deepseek-r1-lite$/i,
      /^deepseek-r1-distill(?:-[a-z0-9]+)*-(?:1\.5b|7b|8b|14b|32b|70b)$/i,
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
      /^qwen2[.-]5(?:-[a-z0-9.]+)?-instruct(?:-|$)/i,
      /^qwen2[.-]5-coder(?:-|$)/i,
      /^qwen3-(?:0\.6b|1\.7b|4b|8b|14b|30b)(?:-|$)/i,
    ],
  },
  {
    providers: ['chatglm', 'zhipuai'],
    incompatibleModels: [
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
