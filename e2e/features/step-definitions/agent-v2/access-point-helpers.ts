import type { DifyWorld } from '../../support/world'

export const getCurrentAgentId = (world: DifyWorld) => {
  const agentId = world.createdAgentIds.at(-1)
  if (!agentId)
    throw new Error('No Agent v2 ID found. Create an Agent v2 test agent first.')

  return agentId
}

export const getPreseededResource = (
  world: DifyWorld,
  name: string,
  kind: 'agent' | 'workflow',
) => {
  const resource = world.agentBuilder.preflight.preseededResources[name]
  if (!resource || resource.kind !== kind) {
    throw new Error(
      `Preseeded ${kind} "${name}" is not available. Run the matching preflight step first.`,
    )
  }

  return resource
}

export const getAccessRegion = (world: DifyWorld) =>
  world.getPage().getByRole('region', { name: 'Access Point' })

export const getWebAppCard = (world: DifyWorld) =>
  getAccessRegion(world).locator('article').filter({ hasText: 'Web app' }).first()

export const getServiceApiCard = (world: DifyWorld) =>
  getAccessRegion(world).locator('article').filter({ hasText: 'Backend service API' }).first()

export const getDialog = (world: DifyWorld, name: string | RegExp) =>
  world.getPage().getByRole('dialog', { name })
