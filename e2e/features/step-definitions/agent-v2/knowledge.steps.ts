import type { Locator } from '@playwright/test'
import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createConfiguredTestAgent, getAgentComposerDraft } from '../../agent-v2/support/agent'
import {
  agentBuilderFixedInputs,
  agentBuilderPreseededResources,
} from '../../agent-v2/support/agent-builder-resources'
import {
  createAgentSoulConfigWithKnowledgeDataset,
  normalAgentSoulConfig,
} from '../../agent-v2/support/agent-soul'
import { asArray, asRecord } from '../../agent-v2/support/preflight/common'
import { getCurrentAgentId } from './configure-helpers'

const getPreseededKnowledgeBase = (world: DifyWorld) => {
  const resource =
    world.agentBuilder.preflight.preseededResources[
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

const getKnowledgeSets = async (agentId: string) => {
  const draft = await getAgentComposerDraft(agentId)

  return asArray(asRecord(draft.agent_soul?.knowledge).sets)
}

const openNewKnowledgeRetrievalDialog = async (world: DifyWorld) => {
  const knowledgeSection = getKnowledgeSection(world)

  await expect(knowledgeSection).toBeVisible({ timeout: 30_000 })
  await knowledgeSection.getByRole('button', { name: 'Add knowledge retrieval' }).click()

  const dialog = world.getPage().getByRole('dialog', {
    name: 'Knowledge Retrieval · Agent decide',
  })
  await expect(dialog).toBeVisible()

  return dialog
}

const selectPreseededKnowledgeBase = async (world: DifyWorld, dialog: Locator) => {
  const knowledgeBase = getPreseededKnowledgeBase(world)
  const page = world.getPage()

  await dialog.getByRole('button', { name: 'Add Knowledge' }).click()

  const selectorDialog = page.getByRole('dialog', { name: 'Select reference Knowledge' })
  await expect(selectorDialog).toBeVisible()
  await selectorDialog.getByRole('button').filter({ hasText: knowledgeBase.name }).click()
  await selectorDialog.getByRole('button', { name: 'Add' }).click()
}

const openKnowledgeRetrievalSettings = async (world: DifyWorld, name: string) => {
  const knowledgeSection = getKnowledgeSection(world)

  await expect(knowledgeSection.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 })
  await knowledgeSection.getByText(name, { exact: true }).hover()
  await knowledgeSection
    .getByRole('button', {
      exact: true,
      name: `Edit ${name}`,
    })
    .click()

  const dialog = world.getPage().getByRole('dialog', {
    name: 'Knowledge Retrieval · Agent decide',
  })
  await expect(dialog).toBeVisible()

  return dialog
}

const expectKnowledgeRetrievalDraft = async (
  world: DifyWorld,
  expected: {
    mode: 'generated_query' | 'user_query'
    value?: string
  },
) => {
  const agentId = getCurrentAgentId(world)
  const knowledgeBase = getPreseededKnowledgeBase(world)

  await expect
    .poll(
      async () => {
        const knowledgeSets = await getKnowledgeSets(agentId)
        const knowledgeSet = asRecord(knowledgeSets[0])
        const datasets = asArray(knowledgeSet.datasets)
        const query = asRecord(knowledgeSet.query)
        const retrieval = asRecord(knowledgeSet.retrieval)

        return {
          datasetNames: datasets.map((dataset) => asRecord(dataset).name),
          mode: query.mode,
          name: knowledgeSet.name,
          retrievalMode: retrieval.mode,
          value: query.value ?? undefined,
        }
      },
      { timeout: 30_000 },
    )
    .toEqual({
      datasetNames: expect.arrayContaining([knowledgeBase.name]),
      mode: expected.mode,
      name: 'Retrieval 1',
      retrievalMode: 'multiple',
      value: expected.value,
    })
}

Given(
  'a knowledge-backed Agent v2 test agent has been created via API',
  async function (this: DifyWorld) {
    const knowledgeBase = getPreseededKnowledgeBase(this)
    const agent = await createConfiguredTestAgent({
      agentSoul: createAgentSoulConfigWithKnowledgeDataset(normalAgentSoulConfig, {
        id: knowledgeBase.id,
        name: knowledgeBase.name,
      }),
    })

    this.createdAgentIds.push(agent.id)
    this.lastCreatedAgentName = agent.name
    this.lastCreatedAgentRole = agent.role ?? undefined
  },
)

When(
  'I add the Agent Builder knowledge base as an Agent decide Knowledge Retrieval',
  async function (this: DifyWorld) {
    const dialog = await openNewKnowledgeRetrievalDialog(this)

    await expect(dialog.getByRole('radio', { name: 'Agent decide' })).toBeChecked()
    await selectPreseededKnowledgeBase(this, dialog)
    await expect(
      dialog.getByText(getPreseededKnowledgeBase(this).name, { exact: true }),
    ).toBeVisible()
    await this.getPage().keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  },
)

When(
  'I add the Agent Builder knowledge base as a Custom query Knowledge Retrieval',
  async function (this: DifyWorld) {
    const dialog = await openNewKnowledgeRetrievalDialog(this)

    await dialog.getByRole('radio', { name: 'Custom query' }).click()
    await dialog
      .getByRole('textbox', { name: 'Custom query text' })
      .fill(agentBuilderFixedInputs.customKnowledgeQuery)
    await selectPreseededKnowledgeBase(this, dialog)
    await expect(
      dialog.getByText(getPreseededKnowledgeBase(this).name, { exact: true }),
    ).toBeVisible()
    await this.getPage().keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  },
)

Then(
  'I should see the Agent v2 Knowledge Retrieval {string}',
  async function (this: DifyWorld, name: string) {
    const knowledgeSection = getKnowledgeSection(this)

    await expect(knowledgeSection).toBeVisible({ timeout: 30_000 })
    await expect(knowledgeSection.getByText(name, { exact: true })).toBeVisible()
  },
)

Then(
  'the Agent v2 Agent decide Knowledge Retrieval should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    await expectKnowledgeRetrievalDraft(this, {
      mode: 'generated_query',
    })
  },
)

Then(
  'the Agent v2 Custom query Knowledge Retrieval should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    await expectKnowledgeRetrievalDraft(this, {
      mode: 'user_query',
      value: agentBuilderFixedInputs.customKnowledgeQuery,
    })
  },
)

Then(
  'I should see the Agent v2 Agent decide Knowledge Retrieval settings',
  async function (this: DifyWorld) {
    const dialog = await openKnowledgeRetrievalSettings(this, 'Retrieval 1')

    await expect(dialog.getByRole('radio', { name: 'Agent decide' })).toBeChecked()
    await expect(
      dialog.getByText(getPreseededKnowledgeBase(this).name, { exact: true }),
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Disabled' })).toBeVisible()
  },
)

Then(
  'I should see the Agent v2 Custom query Knowledge Retrieval settings',
  async function (this: DifyWorld) {
    const dialog = await openKnowledgeRetrievalSettings(this, 'Retrieval 1')

    await expect(dialog.getByRole('radio', { name: 'Custom query' })).toBeChecked()
    await expect(dialog.getByRole('textbox', { name: 'Custom query text' })).toHaveValue(
      agentBuilderFixedInputs.customKnowledgeQuery,
    )
    await expect(
      dialog.getByText(getPreseededKnowledgeBase(this).name, { exact: true }),
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Disabled' })).toBeVisible()
  },
)

When(
  'I remove the Agent v2 Knowledge Retrieval {string}',
  async function (this: DifyWorld, name: string) {
    const knowledgeSection = getKnowledgeSection(this)

    await expect(knowledgeSection).toBeVisible({ timeout: 30_000 })
    await knowledgeSection.getByText(name, { exact: true }).hover()
    await knowledgeSection
      .getByRole('button', {
        exact: true,
        name: `Remove ${name}`,
      })
      .click()
  },
)

Then(
  'the Agent v2 draft should no longer reference the Agent Builder knowledge base',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)
    const knowledgeBase = getPreseededKnowledgeBase(this)

    await expect
      .poll(
        async () => {
          const knowledgeSets = await getKnowledgeSets(agentId)

          return knowledgeSets.some((set) =>
            asArray(asRecord(set).datasets).some((dataset) => {
              const record = asRecord(dataset)

              return record.id === knowledgeBase.id || record.name === knowledgeBase.name
            }),
          )
        },
        { timeout: 30_000 },
      )
      .toBe(false)
  },
)

Then(
  'I should not see the Agent v2 Knowledge Retrieval {string}',
  async function (this: DifyWorld, name: string) {
    const knowledgeSection = getKnowledgeSection(this)

    await expect(knowledgeSection).toBeVisible({ timeout: 30_000 })
    await expect(knowledgeSection.getByText(name, { exact: true })).not.toBeVisible()
  },
)
