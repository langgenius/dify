import type { DifyWorld } from '../features/support/world'
import { agentBuilderPreseededResources } from './agent-builder-resources'

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
