import type {
  AgentKnowledgeDatasetConfig,
  AgentSoulConfig,
} from '@dify/contracts/api/console/agent/types.gen'

export type AgentComposerEnvVariable = NonNullable<
  NonNullable<AgentSoulConfig['env']>['variables']
>[number]

export type AgentModelSelection = {
  name: string
  provider: string
}

export const defaultAgentSoulConfig: AgentSoulConfig = {
  prompt: {
    system_prompt: 'You are a Dify Agent E2E test assistant.',
  },
}

export const normalAgentPrompt
  = 'You are a Dify Agent E2E test assistant. Reply briefly to every user message, and always include AGENT_E2E_PASS in your response.'

export const updatedAgentPrompt
  = 'You are a Dify Agent E2E test assistant. Every response must start with E2E_AGENT_UPDATED.'

export const concurrentFirstAgentPrompt
  = 'You are a Dify Agent E2E concurrent edit assistant. Always include E2E_CONCURRENT_FIRST in saved instructions.'

export const concurrentSecondAgentPrompt
  = 'You are a Dify Agent E2E concurrent edit assistant. Always include E2E_CONCURRENT_SECOND in saved instructions.'

export const normalAgentSoulConfig: AgentSoulConfig = {
  prompt: {
    system_prompt: normalAgentPrompt,
  },
}

export const publishOnlyAgentModel: AgentModelSelection = {
  name: 'gpt-5-nano',
  provider: 'openai',
}

export const updatedAgentSoulConfig: AgentSoulConfig = {
  prompt: {
    system_prompt: updatedAgentPrompt,
  },
}

const stableAgentModelSettings = {
  max_tokens: 4096,
  temperature: 0,
}

const getAgentModelPluginId = (provider: string) => {
  const [organization, pluginName] = provider.split('/').filter(Boolean)

  if (organization && pluginName)
    return `${organization}/${pluginName}`

  return provider ? `langgenius/${provider}` : ''
}

const getExistingModelConfig = (agentSoul: AgentSoulConfig) => {
  const model = agentSoul.model

  if (model && typeof model === 'object' && !Array.isArray(model))
    return model as Record<string, unknown>

  return {}
}

export function createAgentSoulConfigWithModel(
  agentSoul: AgentSoulConfig,
  model: AgentModelSelection,
): AgentSoulConfig {
  return {
    ...agentSoul,
    model: {
      ...getExistingModelConfig(agentSoul),
      plugin_id: getAgentModelPluginId(model.provider),
      model_provider: model.provider,
      model: model.name,
      model_settings: stableAgentModelSettings,
    },
  }
}

export function createPublishableAgentSoulConfig(agentSoul: AgentSoulConfig): AgentSoulConfig {
  if (agentSoul.model)
    return agentSoul

  return createAgentSoulConfigWithModel(agentSoul, publishOnlyAgentModel)
}

export function createAgentSoulConfigWithKnowledgeDataset(
  agentSoul: AgentSoulConfig,
  dataset: AgentKnowledgeDatasetConfig,
): AgentSoulConfig {
  return {
    ...agentSoul,
    knowledge: {
      sets: [
        {
          datasets: [dataset],
          id: 'e2e-knowledge-retrieval',
          name: 'Retrieval 1',
          query: {
            mode: 'generated_query',
          },
          retrieval: {
            mode: 'multiple',
            top_k: 4,
          },
        },
      ],
    },
  }
}

export function createAgentSoulConfigWithDifyTool(
  agentSoul: AgentSoulConfig,
  tool: NonNullable<NonNullable<AgentSoulConfig['tools']>['dify_tools']>[number],
): AgentSoulConfig {
  return {
    ...agentSoul,
    tools: {
      ...agentSoul.tools,
      dify_tools: [
        ...(agentSoul.tools?.dify_tools ?? []),
        tool,
      ],
    },
  }
}
