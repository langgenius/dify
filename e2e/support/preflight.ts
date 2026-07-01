import type { DifyWorld } from '../features/support/world'
import { agentBuilderPreseededResources } from './agent-builder-resources'
import { createApiContext, expectApiResponseOK } from './api'

const stableChatModelProviderEnv = 'E2E_STABLE_MODEL_PROVIDER'
const stableChatModelNameEnv = 'E2E_STABLE_MODEL_NAME'
const stableChatModelTypeEnv = 'E2E_STABLE_MODEL_TYPE'
const defaultStableChatModelType = 'llm'

export type E2EResourcePrecondition
  = | {
    ok: true
    value: string
  }
  | {
    ok: false
    reason: string
  }

export const readRequiredEnvResource = (
  envName: string,
  description: string,
): E2EResourcePrecondition => {
  const value = process.env[envName]?.trim()
  if (value)
    return { ok: true, value }

  return {
    ok: false,
    reason: `${description} requires ${envName}.`,
  }
}

export function skipBlockedPrecondition(world: DifyWorld, reason: string): 'skipped' {
  const message = `Blocked precondition: ${reason}`
  console.warn(`[e2e] ${message}`)
  world.attach(message, 'text/plain')
  return 'skipped'
}

export function skipMissingEnvResource(
  world: DifyWorld,
  envName: string,
  description: string,
): 'skipped' | string {
  const resource = readRequiredEnvResource(envName, description)
  if (resource.ok)
    return resource.value

  return skipBlockedPrecondition(world, resource.reason)
}

export const requiredAgentBuilderPreseededResources = Object.values(agentBuilderPreseededResources)

export function skipMissingAgentBuilderPreseed(
  world: DifyWorld,
  resourceName: string,
  envName: string,
): 'skipped' | string {
  return skipMissingEnvResource(
    world,
    envName,
    `Preseeded Agent Builder resource "${resourceName}"`,
  )
}

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

type StableChatModelConfig
  = | {
    ok: true
    provider: string
    type: string
    value: string
  }
  | {
    ok: false
    reason: string
  }

export function readAgentBuilderStableChatModelConfig(): StableChatModelConfig {
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

  return { ok: true, provider, type, value: name }
}

export async function skipMissingAgentBuilderStableChatModel(
  world: DifyWorld,
): Promise<'skipped' | NonNullable<DifyWorld['agentBuilderStableChatModel']>> {
  const config = readAgentBuilderStableChatModelConfig()
  if (!config.ok)
    return skipBlockedPrecondition(world, config.reason)

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/workspaces/current/models/model-types/${config.type}`)
    await expectApiResponseOK(response, `Check ${agentBuilderPreseededResources.stableChatModel}`)
    const body = (await response.json()) as ModelTypeListResponse
    const provider = body.data.find(item => item.provider === config.provider)
    const model = provider?.models.find(item =>
      item.model === config.value
      || item.label?.en_US === config.value
      || item.label?.zh_Hans === config.value,
    )

    if (!provider || !model) {
      return skipBlockedPrecondition(
        world,
        `${agentBuilderPreseededResources.stableChatModel} was not found as ${config.provider}/${config.value} (${config.type}).`,
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
