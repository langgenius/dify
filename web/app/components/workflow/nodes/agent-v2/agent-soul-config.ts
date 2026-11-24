import type { AgentSoulConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { DefaultModelResponse } from '@/app/components/header/account-setting/model-provider-page/declarations'

function getModelProviderPluginId(provider: string) {
  const [organization, pluginName] = provider.split('/').filter(Boolean)

  if (organization && pluginName) return `${organization}/${pluginName}`

  return provider ? `langgenius/${provider}` : ''
}

export function getDefaultAgentSoul(defaultModel?: DefaultModelResponse): AgentSoulConfig {
  const baseConfig: AgentSoulConfig = {
    schema_version: 1,
    prompt: {
      system_prompt: '',
    },
  }

  if (!defaultModel) return baseConfig

  const modelProvider = defaultModel.provider.provider

  return {
    ...baseConfig,
    model: {
      model_provider: modelProvider,
      model: defaultModel.model,
      plugin_id: getModelProviderPluginId(modelProvider),
    },
  }
}
