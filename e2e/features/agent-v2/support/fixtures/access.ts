import type { ConsoleClient } from '../../../../support/api/console-client.ts'
import type { DifyWorld } from '../../../support/world.ts'
import type { PreseededResource } from './common.ts'
import { requirePreseededAgent, requirePreseededWorkflow } from './agents.ts'
import { failFixturePrerequisite } from './common.ts'

export async function requirePreseededAgentWorkflowReference(
  world: DifyWorld,
  client: ConsoleClient,
  agentName: string,
  workflowName: string,
): Promise<PreseededResource> {
  const agent = await requirePreseededAgent(world, client, agentName)

  const workflow = await requirePreseededWorkflow(world, client, workflowName)

  const references = await client.agent.byAgentId.referencingWorkflows.get({
    params: { agent_id: agent.id },
  })
  const reference = references.data?.find(
    (item) => item.app_id === workflow.id || item.app_name === workflow.name,
  )

  if (!reference) {
    return failFixturePrerequisite(
      world,
      `Preseeded Agent "${agentName}" is not referenced by workflow "${workflowName}".`,
    )
  }

  if (!reference.node_ids || reference.node_ids.length < 1) {
    return failFixturePrerequisite(
      world,
      `Preseeded workflow "${workflowName}" does not expose Agent reference nodes for "${agentName}".`,
    )
  }

  return {
    id: workflow.id,
    kind: 'workflow',
    name: workflow.name,
  }
}
