import type { Model, ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'

type ProviderModelCompatibility = {
  provider: string
  unsupportedModels: RegExp[]
}

const agentUnsupportedModelConfig: ProviderModelCompatibility[] = [
  {
    provider: 'openai',
    unsupportedModels: [
      /^gpt-4(?:-|$)/i,
      /^gpt-3\.5/i,
    ],
  },
]

const normalizeProviderName = (provider: string) => provider.split('/').at(-1)?.toLowerCase() ?? provider.toLowerCase()

export function isAgentCompatibleModel(provider: Model, modelItem: ModelItem) {
  const providerName = normalizeProviderName(provider.provider)
  const providerConfig = agentUnsupportedModelConfig.find(config => config.provider === providerName)

  if (!providerConfig)
    return true

  return !providerConfig.unsupportedModels.some(pattern => pattern.test(modelItem.model))
}
