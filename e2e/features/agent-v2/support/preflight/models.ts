import type { DifyWorld } from '../../../support/world'
import { createApiContext, expectApiResponseOK } from '../../../../support/api'
import { agentBuilderPreseededResources } from '../agent-builder-resources'
import { skipBlockedPrecondition } from './common'

const stableChatModelProviderEnv = 'E2E_STABLE_MODEL_PROVIDER'
const stableChatModelNameEnv = 'E2E_STABLE_MODEL_NAME'
const stableChatModelTypeEnv = 'E2E_STABLE_MODEL_TYPE'
const brokenChatModelProviderEnv = 'E2E_BROKEN_MODEL_PROVIDER'
const brokenChatModelNameEnv = 'E2E_BROKEN_MODEL_NAME'
const brokenChatModelTypeEnv = 'E2E_BROKEN_MODEL_TYPE'
const activeModelStatus = 'active'
const defaultStableChatModelType = 'llm'
const defaultBrokenChatModelName = agentBuilderPreseededResources.brokenModel

type ModelTypeListResponse = {
  data: Array<{
    provider: string
    models: Array<{
      label?: {
        en_US?: string
        zh_Hans?: string
      }
      model: string
      status?: string
    }>
    status?: string
  }>
}

type ModelPreflightConfig
  = | {
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
  const provider = process.env[stableChatModelProviderEnv]?.trim()
  const name = process.env[stableChatModelNameEnv]?.trim()
  const type = process.env[stableChatModelTypeEnv]?.trim() || defaultStableChatModelType

  const missing: string[] = []
  if (!provider)
    missing.push(stableChatModelProviderEnv)
  if (!name)
    missing.push(stableChatModelNameEnv)

  if (!provider || !name) {
    return {
      ok: false,
      reason: `${agentBuilderPreseededResources.stableChatModel} requires ${missing.join(', ')}.`,
    }
  }

  return {
    ok: true,
    provider,
    resourceName: agentBuilderPreseededResources.stableChatModel,
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
  if (!config.ok)
    return skipBlockedPrecondition(world, config.reason)

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(
      `/console/api/workspaces/current/models/model-types/${config.type}`,
    )
    await expectApiResponseOK(response, `Check ${config.resourceName}`)
    const body = (await response.json()) as ModelTypeListResponse
    const provider = body.data.find(item => item.provider === config.provider)
    const model = provider?.models.find(
      item =>
        item.model === config.value
        || item.label?.en_US === config.value
        || item.label?.zh_Hans === config.value,
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
  }
  finally {
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

export async function skipMissingAgentBuilderBrokenChatModel(
  world: DifyWorld,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilder']['preflight']['stableModel']>> {
  return skipMissingAgentBuilderModel(world, readAgentBuilderBrokenChatModelConfig(), {
    requireActive: false,
  })
}
