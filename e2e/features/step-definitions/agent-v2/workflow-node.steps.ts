import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp, syncAgentV2WorkflowDraft } from '../../../support/api'
import { createE2EResourceName } from '../../../support/naming'
import { createConfiguredTestAgent, publishAgent } from '../../agent-v2/support/agent'
import {
  createAgentSoulConfigWithModel,
  normalAgentPrompt,
  normalAgentSoulConfig,
} from '../../agent-v2/support/agent-soul'

Given(
  'a workflow app with an Agent v2 node has been created via API',
  async function (this: DifyWorld) {
    if (!this.agentBuilder.fixtures.stableModel)
      throw new Error('Create an Agent v2 workflow node after stable model fixture setup.')

    const agent = await createConfiguredTestAgent({
      agentSoul: createAgentSoulConfigWithModel(
        normalAgentSoulConfig,
        this.agentBuilder.fixtures.stableModel,
      ),
    })
    this.createdAgentIds.push(agent.id)
    this.lastCreatedAgentName = agent.name
    this.lastCreatedAgentRole = agent.role ?? undefined
    await publishAgent(agent.id)

    const app = await createTestApp(createE2EResourceName('App', 'workflow-agent-v2'), 'workflow')
    this.createdAppIds.push(app.id)
    this.lastCreatedAppName = app.name

    await syncAgentV2WorkflowDraft(app.id, agent.id)
  },
)

When('I open the Agent v2 workflow node panel', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentNode = page.getByRole('button', { name: 'Agent', exact: true })

  await expect(agentNode).toBeVisible({ timeout: 30_000 })
  await agentNode.click()
  await expect(page.getByRole('button', { name: 'Output Variables' })).toBeVisible()
})

When('I open the Agent v2 workflow Agent details', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentName = this.lastCreatedAgentName
  if (!agentName) throw new Error('No Agent v2 name found. Create a workflow Agent v2 node first.')

  await page.getByRole('button', { name: `Open ${agentName} details` }).click()
  await expect(page.getByRole('dialog', { exact: true, name: agentName })).toBeVisible()
})

When('I open the Agent v2 workflow Agent in Agent Console', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentName = this.lastCreatedAgentName
  if (!agentName) throw new Error('No Agent v2 name found. Create a workflow Agent v2 node first.')

  const detailsDialog = page.getByRole('dialog', { exact: true, name: agentName })
  const [agentConsolePage] = await Promise.all([
    page.waitForEvent('popup'),
    detailsDialog.getByRole('link', { name: 'Edit in Agent Console' }).click(),
  ])

  this.agentBuilder.workflow.agentConsolePage = agentConsolePage
})

Then(
  'I should see the Agent v2 workflow Agent details for the created Agent',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const agentName = this.lastCreatedAgentName
    const agentRole = this.lastCreatedAgentRole
    const stableModel = this.agentBuilder.fixtures.stableModel
    if (!agentName)
      throw new Error('No Agent v2 name found. Create a workflow Agent v2 node first.')
    if (!stableModel)
      throw new Error(
        'Stable chat model fixture setup must run before asserting workflow Agent details.',
      )

    const detailsDialog = page.getByRole('dialog', { exact: true, name: agentName })

    await expect(detailsDialog).toBeVisible()
    await expect(detailsDialog.getByText(agentName, { exact: true })).toBeVisible()
    if (agentRole) await expect(detailsDialog.getByText(agentRole, { exact: true })).toBeVisible()
    await expect(detailsDialog.getByText(stableModel.name, { exact: true })).toBeVisible()
    await expect(detailsDialog.getByText(normalAgentPrompt)).toBeVisible()
    await expect(
      detailsDialog.getByRole('link', { name: 'Edit in Agent Console' }),
    ).toHaveAttribute('href', `/agents/${this.createdAgentIds.at(-1)}/configure`)
  },
)

Then(
  'the Agent v2 Agent Console should open for the same workflow Agent',
  async function (this: DifyWorld) {
    const agentConsolePage = this.agentBuilder.workflow.agentConsolePage
    const agentId = this.createdAgentIds.at(-1)
    const agentName = this.lastCreatedAgentName
    const stableModel = this.agentBuilder.fixtures.stableModel
    if (!agentConsolePage) throw new Error('Agent Console page was not opened.')
    if (!agentId || !agentName)
      throw new Error('No Agent v2 ID or name found. Create a workflow Agent v2 node first.')
    if (!stableModel)
      throw new Error('Stable chat model fixture setup must run before asserting Agent Console.')

    await expect(agentConsolePage).toHaveURL(new RegExp(`/agents/${agentId}/configure(?:\\?.*)?$`))
    await expect(agentConsolePage.getByRole('heading', { name: 'Configure' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(agentConsolePage.getByText(agentName, { exact: true })).toBeVisible()
    await expect(agentConsolePage.getByText(stableModel.name, { exact: true })).toBeVisible()
    await expect(agentConsolePage.getByText(normalAgentPrompt)).toBeVisible()

    await agentConsolePage.close()
    this.agentBuilder.workflow.agentConsolePage = undefined
  },
)
