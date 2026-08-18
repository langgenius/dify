import type { AgentReferencingWorkflowsResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { DifyWorld } from '../../../support/world'
import type { PreseededResource } from './common'
import { createApiContext, expectApiResponseOK } from '../../../../support/api'
import { requirePreseededAgent, requirePreseededWorkflow } from './agents'
import { failFixturePrerequisite } from './common'

export async function requirePreseededAgentWorkflowReference(
  world: DifyWorld,
  agentName: string,
  workflowName: string,
): Promise<PreseededResource> {
  const agent = await requirePreseededAgent(world, agentName)

  const workflow = await requirePreseededWorkflow(world, workflowName)

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/referencing-workflows`)
    await expectApiResponseOK(response, `Check preseeded Agent workflow reference ${agentName}`)
    const references = (await response.json()) as AgentReferencingWorkflowsResponse
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
  } finally {
    await ctx.dispose()
  }
}
