import type {
  DefaultModelDataResponse,
  ProviderWithModelsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { DifyWorld } from '../../../support/world'
import { createApiContext, expectApiResponseOK } from '../../../../support/api'
import { agentBuilderPreseededResources } from '../agent-builder-resources'
import { skipBlockedPrecondition } from './common'

const stableChatModelProviderEnv = 'E2E_STABLE_MODEL_PROVIDER'
const stableChatModelNameEnv = 'E2E_STABLE_MODEL_NAME'
const stableChatModelTypeEnv = 'E2E_STABLE_MODEL_TYPE'
const agentDecisionChatModelProviderEnv = 'E2E_AGENT_DECISION_MODEL_PROVIDER'
const agentDecisionChatModelNameEnv = 'E2E_AGENT_DECISION_MODEL_NAME'
const agentDecisionChatModelTypeEnv = 'E2E_AGENT_DECISION_MODEL_TYPE'
const brokenChatModelProviderEnv = 'E2E_BROKEN_MODEL_PROVIDER'
const brokenChatModelNameEnv = 'E2E_BROKEN_MODEL_NAME'
const brokenChatModelTypeEnv = 'E2E_BROKEN_MODEL_TYPE'
const activeModelStatus = 'active'
const defaultStableChatModelProvider = 'openai'
const defaultStableChatModelName = 'gpt-5-nano'
const defaultStableChatModelType = 'llm'
const defaultAgentDecisionChatModelProvider = 'openai'
const defaultAgentDecisionChatModelName = 'gpt-5.5'
const defaultAgentDecisionChatModelType = 'llm'
const defaultBrokenChatModelName = agentBuilderPreseededResources.brokenModel

const getProviderAlias = (provider: string) =>
  provider.split('/').filter(Boolean).at(-1) ?? provider

const matchesProvider = (actual: string, expected: string) =>
  actual === expected || getProviderAlias(actual) === getProviderAlias(expected)

type ModelPreflightConfig =
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

export function readAgentBuilderStableChatModelConfig(): ModelPreflightConfig {
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

export function readAgentBuilderAgentDecisionChatModelConfig(): ModelPreflightConfig {
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

export function readAgentBuilderBrokenChatModelConfig(): ModelPreflightConfig {
  const provider = process.env[brokenChatModelProviderEnv]?.trim()
  const name = process.env[brokenChatModelNameEnv]?.trim() || defaultBrokenChatModelName
  const type = process.env[brokenChatModelTypeEnv]?.trim() || defaultStableChatModelType

  if (!provider) {
    return {
      ok: false,
      reason: `${agentBuilderPreseededResources.brokenModelProvider} requires ${brokenChatModelProviderEnv}.`,
    }
  }

  return {
    ok: true,
    provider,
    resourceName: agentBuilderPreseededResources.brokenModelProvider,
    type,
    value: name,
  }
}

async function skipMissingAgentBuilderModel(
  world: DifyWorld,
  config: ModelPreflightConfig,
  {
    requireActive,
  }: {
    requireActive: boolean
  },
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['stableModel']>> {
  if (!config.ok) return skipBlockedPrecondition(world, config.reason)

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(
      `/console/api/workspaces/current/models/model-types/${config.type}`,
    )
    await expectApiResponseOK(response, `Check ${config.resourceName}`)
    const body = (await response.json()) as { data: ProviderWithModelsResponse[] }
    const provider = body.data.find((item) => matchesProvider(item.provider, config.provider))
    const model = provider?.models.find(
      (item) =>
        item.model === config.value ||
        item.label?.en_US === config.value ||
        item.label?.zh_Hans === config.value,
    )

    if (!provider || !model) {
      return skipBlockedPrecondition(
        world,
        `${config.resourceName} was not found as ${config.provider}/${config.value} (${config.type}).`,
      )
    }

    if (requireActive && model.status !== activeModelStatus) {
      return skipBlockedPrecondition(
        world,
        `${config.resourceName} is ${model.status ?? 'missing status'} instead of ${activeModelStatus}.`,
      )
    }

    return {
      name: model.model,
      provider: provider.provider,
      type: config.type,
    }
  } finally {
    await ctx.dispose()
  }
}

export async function skipMissingAgentBuilderStableChatModel(
  world: DifyWorld,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['stableModel']>> {
  return skipMissingAgentBuilderModel(world, readAgentBuilderStableChatModelConfig(), {
    requireActive: true,
  })
}

export async function skipMissingAgentBuilderSpeechToTextModel(
  world: DifyWorld,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['speechToTextModel']>> {
  const ctx = await createApiContext()
  let defaultModel: NonNullable<DefaultModelDataResponse['data']>

  try {
    const response = await ctx.get(
      '/console/api/workspaces/current/default-model?model_type=speech2text',
    )
    await expectApiResponseOK(response, `Check ${agentBuilderPreseededResources.speechToTextModel}`)
    const body = (await response.json()) as DefaultModelDataResponse
    if (!body.data) {
      return skipBlockedPrecondition(
        world,
        `${agentBuilderPreseededResources.speechToTextModel} is not configured.`,
        {
          owner: 'model-provider/seed',
          remediation:
            'Configure an active workspace default Speech-to-Text model before running the external scenario.',
        },
      )
    }
    defaultModel = body.data
  } finally {
    await ctx.dispose()
  }

  return skipMissingAgentBuilderModel(
    world,
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

export async function skipMissingAgentBuilderAgentDecisionChatModel(
  world: DifyWorld,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['stableModel']>> {
  return skipMissingAgentBuilderModel(world, readAgentBuilderAgentDecisionChatModelConfig(), {
    requireActive: true,
  })
}

export async function skipMissingAgentBuilderBrokenChatModel(
  world: DifyWorld,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['stableModel']>> {
  return skipMissingAgentBuilderModel(world, readAgentBuilderBrokenChatModelConfig(), {
    requireActive: false,
  })
}
