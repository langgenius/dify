import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import {
  createAgentSoulConfigWithKnowledgeDataset,
  createConfiguredTestAgent,
  getAgentComposerDraft,
  normalAgentSoulConfig,
} from '../../agent-v2/support/agent'
import { agentBuilderPreseededResources } from '../../agent-v2/support/agent-builder-resources'
import { asArray, asRecord } from '../../agent-v2/support/preflight/common'
import { getCurrentAgentId } from './configure-helpers'

const getPreseededKnowledgeBase = (world: DifyWorld) => {
  const resource = world.agentBuilder.preflight.preseededResources[
    agentBuilderPreseededResources.agentKnowledgeBase
  ]
  if (!resource || resource.kind !== 'dataset') {
    throw new Error(
      `Preseeded dataset "${agentBuilderPreseededResources.agentKnowledgeBase}" is not available. Run the matching preflight step first.`,
    )
  }

  return resource
}

const getKnowledgeSection = (world: DifyWorld) =>
  world.getPage().getByRole('region', { name: 'Knowledge Retrieval' })

Given(
  'a knowledge-backed Agent v2 test agent has been created via API',
  async function (this: DifyWorld) {
    const knowledgeBase = getPreseededKnowledgeBase(this)
    const agent = await createConfiguredTestAgent({
      agentSoul: createAgentSoulConfigWithKnowledgeDataset(
        normalAgentSoulConfig,
        {
          id: knowledgeBase.id,
          name: knowledgeBase.name,
        },
      ),
    })

    this.createdAgentIds.push(agent.id)
    this.lastCreatedAgentName = agent.name
    this.lastCreatedAgentRole = agent.role ?? undefined
  },
)

Then('I should see the Agent v2 Knowledge Retrieval {string}', async function (this: DifyWorld, name: string) {
  const knowledgeSection = getKnowledgeSection(this)

  await expect(knowledgeSection).toBeVisible({ timeout: 30_000 })
  await expect(knowledgeSection.getByText(name, { exact: true })).toBeVisible()
})

When('I remove the Agent v2 Knowledge Retrieval {string}', async function (this: DifyWorld, name: string) {
  const knowledgeSection = getKnowledgeSection(this)

  await expect(knowledgeSection).toBeVisible({ timeout: 30_000 })
  await knowledgeSection.getByText(name, { exact: true }).hover()
  await knowledgeSection.getByRole('button', {
    exact: true,
    name: `Remove ${name}`,
  }).click()
})

Then(
  'the Agent v2 draft should no longer reference the Agent Builder knowledge base',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)
    const knowledgeBase = getPreseededKnowledgeBase(this)

    await expect.poll(
      async () => {
        const draft = await getAgentComposerDraft(agentId)
        const knowledgeSets = asArray(asRecord(draft.agent_soul?.knowledge).sets)

        return knowledgeSets.some(set => asArray(asRecord(set).datasets).some((dataset) => {
          const record = asRecord(dataset)

          return record.id === knowledgeBase.id || record.name === knowledgeBase.name
        }))
      },
      { timeout: 30_000 },
    ).toBe(false)
  },
)

Then('I should not see the Agent v2 Knowledge Retrieval {string}', async function (this: DifyWorld, name: string) {
  const knowledgeSection = getKnowledgeSection(this)

  await expect(knowledgeSection).toBeVisible({ timeout: 30_000 })
  await expect(knowledgeSection.getByText(name, { exact: true })).not.toBeVisible()
})
