import type { ConsoleClient } from '../../../../support/api/console-client'
import type { DifyWorld } from '../../../support/world'
import { agentBuilderPreseededResources } from '../agent-builder-resources'
import { failFixturePrerequisite } from './common'

const stableChatModelProviderEnv = 'E2E_STABLE_MODEL_PROVIDER'
const stableChatModelNameEnv = 'E2E_STABLE_MODEL_NAME'
const stableChatModelTypeEnv = 'E2E_STABLE_MODEL_TYPE'
const agentDecisionChatModelProviderEnv = 'E2E_AGENT_DECISION_MODEL_PROVIDER'
const agentDecisionChatModelNameEnv = 'E2E_AGENT_DECISION_MODEL_NAME'
const agentDecisionChatModelTypeEnv = 'E2E_AGENT_DECISION_MODEL_TYPE'
const activeModelStatus = 'active'
const defaultStableChatModelProvider = 'openai'
const defaultStableChatModelName = 'gpt-5-nano'
const defaultStableChatModelType = 'llm'
const defaultAgentDecisionChatModelProvider = 'openai'
const defaultAgentDecisionChatModelName = 'gpt-5.5'
const defaultAgentDecisionChatModelType = 'llm'

const getProviderAlias = (provider: string) =>
  provider.split('/').filter(Boolean).at(-1) ?? provider

const matchesProvider = (actual: string, expected: string) =>
  actual === expected || getProviderAlias(actual) === getProviderAlias(expected)

type ModelFixtureConfig =
  | {
      ok: true
      provider: string
      resourceName: string
      type: string
      value: string
    }
  | {
      ok: false
      reason: string
    }

export function readAgentBuilderStableChatModelConfig(): ModelFixtureConfig {
  const provider = process.env[stableChatModelProviderEnv]?.trim() || defaultStableChatModelProvider
  const name = process.env[stableChatModelNameEnv]?.trim() || defaultStableChatModelName
  const type = process.env[stableChatModelTypeEnv]?.trim() || defaultStableChatModelType

  return {
    ok: true,
    provider,
    resourceName: agentBuilderPreseededResources.stableChatModel,
    type,
    value: name,
  }
}

export function readAgentBuilderAgentDecisionChatModelConfig(): ModelFixtureConfig {
  const provider =
    process.env[agentDecisionChatModelProviderEnv]?.trim() || defaultAgentDecisionChatModelProvider
  const name =
    process.env[agentDecisionChatModelNameEnv]?.trim() || defaultAgentDecisionChatModelName
  const type =
    process.env[agentDecisionChatModelTypeEnv]?.trim() || defaultAgentDecisionChatModelType

  return {
    ok: true,
    provider,
    resourceName: agentBuilderPreseededResources.agentDecisionChatModel,
    type,
    value: name,
  }
}

async function requireAgentBuilderModel(
  world: DifyWorld,
  client: ConsoleClient,
  config: ModelFixtureConfig,
  {
    requireActive,
  }: {
    requireActive: boolean
  },
): Promise<NonNullable<DifyWorld['agentBuilder']['fixtures']['stableModel']>> {
  if (!config.ok) return failFixturePrerequisite(world, config.reason)

  const response = await client.workspaces.current.models.modelTypes.byModelType.get({
    params: { model_type: config.type },
  })
  const provider = response.data.find((item) => matchesProvider(item.provider, config.provider))
  const model = provider?.models.find(
    (item) =>
      item.model === config.value ||
      item.label?.en_US === config.value ||
      item.label?.zh_Hans === config.value,
  )

  if (!provider || !model) {
    return failFixturePrerequisite(
      world,
      `${config.resourceName} was not found as ${config.provider}/${config.value} (${config.type}).`,
    )
  }

  if (requireActive && model.status !== activeModelStatus) {
    return failFixturePrerequisite(
      world,
      `${config.resourceName} is ${model.status ?? 'missing status'} instead of ${activeModelStatus}.`,
    )
  }

  return {
    name: model.model,
    provider: provider.provider,
    type: config.type,
  }
}

export async function requireAgentBuilderStableChatModel(
  world: DifyWorld,
  client: ConsoleClient,
): Promise<NonNullable<DifyWorld['agentBuilder']['fixtures']['stableModel']>> {
  return requireAgentBuilderModel(world, client, readAgentBuilderStableChatModelConfig(), {
    requireActive: true,
  })
}

export async function requireAgentBuilderSpeechToTextModel(
  world: DifyWorld,
  client: ConsoleClient,
): Promise<NonNullable<DifyWorld['agentBuilder']['fixtures']['speechToTextModel']>> {
  const response = await client.workspaces.current.defaultModel.get({
    query: { model_type: 'speech2text' },
  })
  if (!response.data) {
    return failFixturePrerequisite(
      world,
      `${agentBuilderPreseededResources.speechToTextModel} is not configured.`,
      {
        owner: 'model-provider/seed',
        remediation:
          'Configure an active workspace default Speech-to-Text model before running the external scenario.',
      },
    )
  }
  const defaultModel = response.data

  return requireAgentBuilderModel(
    world,
    client,
    {
      ok: true,
      provider: defaultModel.provider.provider,
      resourceName: agentBuilderPreseededResources.speechToTextModel,
      type: 'speech2text',
      value: defaultModel.model,
    },
    {
      requireActive: true,
    },
  )
}

export async function requireAgentBuilderAgentDecisionChatModel(
  world: DifyWorld,
  client: ConsoleClient,
): Promise<NonNullable<DifyWorld['agentBuilder']['fixtures']['stableModel']>> {
  return requireAgentBuilderModel(world, client, readAgentBuilderAgentDecisionChatModelConfig(), {
    requireActive: true,
  })
}
