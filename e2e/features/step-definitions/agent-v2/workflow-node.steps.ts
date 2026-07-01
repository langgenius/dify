import type { DataTable } from '@cucumber/cucumber'
import type { AgentV2WorkflowOutputVariable, DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import {
  createTestApp,
  getWorkflowDraft,
  syncAgentV2WorkflowDraft,
} from '../../../support/api'
import { createE2EResourceName } from '../../../support/naming'
import {
  createAgentSoulConfigWithModel,
  createConfiguredTestAgent,
  normalAgentSoulConfig,
} from '../../agent-v2/support/agent'

const agentV2WorkflowNodeId = 'agent-v2'

const getCurrentAppId = (world: DifyWorld) => {
  const appId = world.createdAppIds.at(-1)
  if (!appId)
    throw new Error('No app ID found. Create a workflow app first.')

  return appId
}

const getOutputVariablesFromDraft = async (appId: string) => {
  const draft = await getWorkflowDraft(appId)
  const agentNode = draft.graph.nodes.find(node => node.id === agentV2WorkflowNodeId)
  if (!agentNode)
    throw new Error(`Workflow draft ${appId} does not include Agent v2 node ${agentV2WorkflowNodeId}.`)

  const outputs = agentNode.data?.agent_declared_outputs
  if (!Array.isArray(outputs))
    return []

  return outputs as Array<{
    array_item?: { type?: string }
    name?: string
    type?: string
  }>
}

Given(
  'a workflow app with an Agent v2 node has been created via API',
  async function (this: DifyWorld) {
    if (!this.agentBuilder.preflight.stableModel)
      throw new Error('Create an Agent v2 workflow node after stable model preflight.')

    const agent = await createConfiguredTestAgent({
      agentSoul: createAgentSoulConfigWithModel(
        normalAgentSoulConfig,
        this.agentBuilder.preflight.stableModel,
      ),
    })
    this.createdAgentIds.push(agent.id)
    this.lastCreatedAgentName = agent.name
    this.lastCreatedAgentRole = agent.role ?? undefined

    const app = await createTestApp(createE2EResourceName('App', 'workflow-agent-v2'), 'workflow')
    this.createdAppIds.push(app.id)
    this.lastCreatedAppName = app.name

    await syncAgentV2WorkflowDraft(app.id, agent.id)
  },
)

When('I open the Agent v2 workflow node panel', async function (this: DifyWorld) {
  const page = this.getPage()
  const workflowCanvas = page.locator('#workflow-container')
  const agentNode = workflowCanvas.getByRole('button', { name: 'Agent' }).first()

  await expect(agentNode).toBeVisible({ timeout: 30_000 })
  await agentNode.click()
  await expect(page.getByRole('button', { name: 'Output Variables' })).toBeVisible()
})

When(
  'I add these Agent v2 workflow node output variables',
  async function (this: DifyWorld, table: DataTable) {
    const page = this.getPage()
    const appId = getCurrentAppId(this)
    const rows = table.hashes() as AgentV2WorkflowOutputVariable[]
    this.agentBuilder.workflow.outputVariables = rows

    await page.getByRole('button', { name: 'Output Variables' }).click()

    for (const row of rows) {
      await page.getByRole('button', { name: 'New output' }).click()
      const editor = page.getByRole('form', { name: 'Output variable editor' })
      await expect(editor).toBeVisible()

      await editor.getByRole('textbox', { name: 'Field name' }).fill(row.name)
      if (row.type !== 'string') {
        await editor.getByRole('button', { name: 'Output type' }).click()
        await page.getByRole('option', { name: row.type }).click()
      }

      const saveResponse = page.waitForResponse(response => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith(`/console/api/apps/${appId}/workflows/draft`)
      ))
      await editor.getByRole('button', { name: 'Confirm' }).click()
      expect((await saveResponse).ok()).toBe(true)
      await expect(editor).not.toBeVisible()
    }
  },
)

Then(
  'the Agent v2 workflow node output variables should be saved in the workflow draft',
  async function (this: DifyWorld) {
    const appId = getCurrentAppId(this)
    const expectedOutputVariables = this.agentBuilder.workflow.outputVariables
    if (expectedOutputVariables.length === 0)
      throw new Error('No Agent v2 workflow output variables were recorded for this scenario.')

    await expect
      .poll(async () => {
        const outputs = await getOutputVariablesFromDraft(appId)

        return expectedOutputVariables.map((expected) => {
          const output = outputs.find(item => item.name === expected.name)
          return {
            name: output?.name,
            type: output?.type === 'array'
              ? `array[${output.array_item?.type ?? 'object'}]`
              : output?.type,
          }
        })
      }, {
        timeout: 30_000,
      })
      .toEqual(expectedOutputVariables)
  },
)

Then('I should see the Agent v2 workflow node output variables', async function (this: DifyWorld) {
  const page = this.getPage()
  const expectedOutputVariables = this.agentBuilder.workflow.outputVariables
  if (expectedOutputVariables.length === 0)
    throw new Error('No Agent v2 workflow output variables were recorded for this scenario.')

  await page.getByRole('button', { name: 'Output Variables' }).click()

  for (const output of expectedOutputVariables) {
    await expect(page.getByText(output.name, { exact: true })).toBeVisible()
    await expect(page.getByText(output.type, { exact: true })).toBeVisible()
  }
})
