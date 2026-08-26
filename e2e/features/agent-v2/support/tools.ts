import type { DifyWorld } from '../../support/world'
import { splitToolDisplayName, splitToolResourceId } from './fixtures/tools'

export const getPreseededToolContract = (world: DifyWorld, resourceName: string) => {
  const resource = world.agentBuilder.fixtures.preseededResources[resourceName]
  if (!resource || resource.kind !== 'tool') {
    throw new Error(
      `Preseeded tool "${resourceName}" is not available. Run the matching fixture setup step first.`,
    )
  }

  const parsedDisplayName = splitToolDisplayName(resource.name)
  const parsedToolId = splitToolResourceId(resource.id)
  if (!parsedDisplayName.ok) throw new Error(parsedDisplayName.reason)
  if (!parsedToolId.providerName || !parsedToolId.toolName)
    throw new Error(`Preseeded tool "${resource.id}" must include provider and tool id segments.`)

  return {
    providerDisplayName: parsedDisplayName.providerName,
    providerName: parsedToolId.providerName,
    toolDisplayName: parsedDisplayName.toolName,
    toolName: parsedToolId.toolName,
  }
}
