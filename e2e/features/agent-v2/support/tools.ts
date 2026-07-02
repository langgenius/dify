import type { DifyWorld } from '../../support/world'
import { splitToolDisplayName } from './preflight/tools'

export const getPreseededToolContract = (world: DifyWorld, resourceName: string) => {
  const resource = world.agentBuilder.preflight.preseededResources[resourceName]
  if (!resource || resource.kind !== 'tool') {
    throw new Error(
      `Preseeded tool "${resourceName}" is not available. Run the matching preflight step first.`,
    )
  }

  const parsedDisplayName = splitToolDisplayName(resource.name)
  const parsedToolId = splitToolDisplayName(resource.id)
  if (!parsedDisplayName.ok)
    throw new Error(parsedDisplayName.reason)
  if (!parsedToolId.ok)
    throw new Error(parsedToolId.reason)

  return {
    providerDisplayName: parsedDisplayName.providerName,
    providerName: parsedToolId.providerName,
    toolDisplayName: parsedDisplayName.toolName,
    toolName: parsedToolId.toolName,
  }
}
