import type { DataTable } from '@cucumber/cucumber'
import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { AgentV2WorkflowOutputVariable, DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { getWorkflowDraft } from '../../../support/api'
import { skipBlockedPrecondition } from '../../agent-v2/support/preflight/common'

const agentV2WorkflowNodeId = 'agent-v2'
const taskFileOutputName = 'e2e_report.pdf'
const renamedTaskFileOutputName = 'e2e_final_report.pdf'

const getAgentOutputToken = (name: string) => `[§output:${name}:${name}§]`

const getCurrentAppId = (world: DifyWorld) => {
  const appId = world.createdAppIds.at(-1)
  if (!appId) throw new Error('No app ID found. Create a workflow app first.')

  return appId
}

const getAgentV2WorkflowNodeData = async (appId: string) => {
  const draft = await getWorkflowDraft(appId)
  const agentNode = draft.graph.nodes.find((node) => node.id === agentV2WorkflowNodeId)
  if (!agentNode)
    throw new Error(
      `Workflow draft ${appId} does not include Agent v2 node ${agentV2WorkflowNodeId}.`,
    )

  return agentNode.data ?? {}
}

const getDeclaredOutputsFromDraft = async (appId: string): Promise<DeclaredOutputConfig[]> => {
  const data = await getAgentV2WorkflowNodeData(appId)
  const outputs = data.agent_declared_outputs
  if (!Array.isArray(outputs)) return []

  return outputs as DeclaredOutputConfig[]
}

const getOutputVariablesFromDraft = async (appId: string) => getDeclaredOutputsFromDraft(appId)

const waitForWorkflowDraftSave = (world: DifyWorld, appId: string) =>
  world
    .getPage()
    .waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(`/console/api/apps/${appId}/workflows/draft`),
    )

const openWorkflowOutputVariablesPanel = async (world: DifyWorld) => {
  const page = world.getPage()
  const newOutputButton = page.getByRole('button', { name: 'New output' })

  if (!(await newOutputButton.isVisible().catch(() => false)))
    await page.getByRole('button', { name: 'Output Variables' }).click()

  await expect(newOutputButton).toBeVisible()
}

const fillOutputVariableEditor = async (
  world: DifyWorld,
  {
    name,
    required = false,
    type = 'string',
  }: {
    name: string
    required?: boolean
    type?: string
  },
) => {
  const page = world.getPage()
  const editor = page.getByRole('form', { name: 'Output variable editor' })

  await expect(editor).toBeVisible()
  await editor.getByRole('textbox', { name: 'Field name' }).fill(name)
  if (type !== 'string') {
    await editor.getByRole('button', { name: 'Output type' }).click()
    await page.getByRole('option', { name: type, exact: true }).click()
  }
  if (required) await editor.getByRole('switch', { name: 'Required' }).click()
}

When(
  'I insert a file output reference from the Agent v2 workflow node task editor',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const appId = getCurrentAppId(this)
    const taskEditor = page.getByRole('textbox', { name: 'Agent task' })

    await expect(taskEditor).toBeVisible()
    await taskEditor.click()
    await page.getByRole('button', { name: 'Insert' }).click()
    await page.getByRole('button', { name: 'New output' }).click()

    const nameInput = page.getByRole('textbox', { name: 'Field name' })
    await expect(nameInput).toBeVisible()
    await nameInput.fill(taskFileOutputName)

    const saveResponse = waitForWorkflowDraftSave(this, appId)
    await nameInput.press('Enter')
    expect((await saveResponse).ok()).toBe(true)
  },
)

When('I rename the Agent v2 workflow node task output reference', async function (this: DifyWorld) {
  const page = this.getPage()
  const appId = getCurrentAppId(this)

  await page.getByText(taskFileOutputName, { exact: true }).hover()
  const editor = page.getByRole('form', { name: 'Output variable editor' })
  await expect(editor).toBeVisible()
  await editor.getByRole('textbox', { name: 'Field name' }).fill(renamedTaskFileOutputName)

  const saveResponse = waitForWorkflowDraftSave(this, appId)
  await editor.getByRole('button', { name: 'Confirm' }).click()
  expect((await saveResponse).ok()).toBe(true)
  await expect(editor).not.toBeVisible()
})

When(
  'I add these Agent v2 workflow node output variables',
  async function (this: DifyWorld, table: DataTable) {
    const page = this.getPage()
    const appId = getCurrentAppId(this)
    const rows = table.hashes() as AgentV2WorkflowOutputVariable[]
    this.agentBuilder.workflow.outputVariables = rows

    await openWorkflowOutputVariablesPanel(this)

    for (const row of rows) {
      await page.getByRole('button', { name: 'New output' }).click()
      await fillOutputVariableEditor(this, row)

      const editor = page.getByRole('form', { name: 'Output variable editor' })
      const saveResponse = waitForWorkflowDraftSave(this, appId)
      await editor.getByRole('button', { name: 'Confirm' }).click()
      expect((await saveResponse).ok()).toBe(true)
      await expect(editor).not.toBeVisible()
    }
  },
)

When(
  'I add a required Agent v2 workflow node object output variable with text and analysis fields',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const appId = getCurrentAppId(this)

    await openWorkflowOutputVariablesPanel(this)
    await page.getByRole('button', { name: 'New output' }).click()
    await fillOutputVariableEditor(this, {
      name: 'response',
      required: true,
      type: 'object',
    })

    let saveResponse = waitForWorkflowDraftSave(this, appId)
    await page
      .getByRole('form', { name: 'Output variable editor' })
      .getByRole('button', { name: 'Confirm' })
      .click()
    expect((await saveResponse).ok()).toBe(true)

    for (const fieldName of ['text', 'analysis']) {
      await page.getByText('response', { exact: true }).hover()
      await page.getByRole('button', { name: 'Add response' }).click()
      await fillOutputVariableEditor(this, { name: fieldName })

      saveResponse = waitForWorkflowDraftSave(this, appId)
      await page
        .getByRole('form', { name: 'Output variable editor' })
        .getByRole('button', { name: 'Confirm' })
        .click()
      expect((await saveResponse).ok()).toBe(true)
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
      .poll(
        async () => {
          const outputs = await getOutputVariablesFromDraft(appId)

          return expectedOutputVariables.map((expected) => {
            const output = outputs.find((item) => item.name === expected.name)
            return {
              name: output?.name,
              type:
                output?.type === 'array'
                  ? `array[${output.array_item?.type ?? 'object'}]`
                  : output?.type,
            }
          })
        },
        {
          timeout: 30_000,
        },
      )
      .toEqual(expectedOutputVariables)
  },
)

Then('I should see the Agent v2 workflow node output variables', async function (this: DifyWorld) {
  const page = this.getPage()
  const expectedOutputVariables = this.agentBuilder.workflow.outputVariables
  if (expectedOutputVariables.length === 0)
    throw new Error('No Agent v2 workflow output variables were recorded for this scenario.')

  await openWorkflowOutputVariablesPanel(this)

  for (const output of expectedOutputVariables) {
    await expect(page.getByText(output.name, { exact: true })).toBeVisible()
    await expect(page.getByText(output.type, { exact: true })).toBeVisible()
  }
})

Then(
  'the Agent v2 workflow node nested object output variable should be saved in the workflow draft',
  async function (this: DifyWorld) {
    const appId = getCurrentAppId(this)

    await expect
      .poll(
        async () => {
          const outputs = await getDeclaredOutputsFromDraft(appId)
          const response = outputs.find((output) => output.name === 'response')

          return {
            children: response?.children?.map((child) => ({
              name: child.name,
              required: child.required,
              type: child.type,
            })),
            name: response?.name,
            required: response?.required,
            type: response?.type,
          }
        },
        {
          timeout: 30_000,
        },
      )
      .toEqual({
        children: [
          {
            name: 'text',
            required: false,
            type: 'string',
          },
          {
            name: 'analysis',
            required: false,
            type: 'string',
          },
        ],
        name: 'response',
        required: true,
        type: 'object',
      })
  },
)

Then(
  'the Agent v2 workflow node task should reference the file output',
  async function (this: DifyWorld) {
    await expectAgentTaskOutputReference(this, taskFileOutputName)
  },
)

Then(
  'the Agent v2 workflow node task should reference the renamed file output',
  async function (this: DifyWorld) {
    await expectAgentTaskOutputReference(this, renamedTaskFileOutputName, taskFileOutputName)
  },
)

Then(
  'I should see the Agent v2 workflow node nested object output variable',
  async function (this: DifyWorld) {
    const page = this.getPage()

    await openWorkflowOutputVariablesPanel(this)
    await expect(page.getByText('response', { exact: true })).toBeVisible()
    await expect(page.getByText('object', { exact: true })).toBeVisible()
    await expect(page.getByText('Required', { exact: true })).toBeVisible()
    await expect(page.getByText('text', { exact: true })).toBeVisible()
    await expect(page.getByText('analysis', { exact: true })).toBeVisible()
    await expect(page.getByText('string', { exact: true })).toBeVisible()
  },
)

async function expectAgentTaskOutputReference(
  world: DifyWorld,
  expectedName: string,
  unexpectedName?: string,
) {
  const page = world.getPage()
  const appId = getCurrentAppId(world)

  await expect
    .poll(
      async () => {
        const data = await getAgentV2WorkflowNodeData(appId)
        const outputs = Array.isArray(data.agent_declared_outputs)
          ? (data.agent_declared_outputs as DeclaredOutputConfig[])
          : []
        const expectedOutput = outputs.find((output) => output.name === expectedName)

        return {
          agentTask: data.agent_task,
          expectedOutput: expectedOutput
            ? {
                name: expectedOutput.name,
                type: expectedOutput.type,
              }
            : undefined,
          unexpectedOutput: unexpectedName
            ? outputs.some((output) => output.name === unexpectedName)
            : false,
        }
      },
      { timeout: 30_000 },
    )
    .toEqual({
      agentTask: expect.stringContaining(getAgentOutputToken(expectedName)),
      expectedOutput: {
        name: expectedName,
        type: 'file',
      },
      unexpectedOutput: false,
    })

  await expect(page.getByText(expectedName, { exact: true })).toBeVisible()
  await expect(page.getByText('file', { exact: true })).toBeVisible()
  if (unexpectedName) await expect(page.getByText(unexpectedName, { exact: true })).toHaveCount(0)
}

async function skipWorkflowTaskOutputReferenceDeletionConsistency(world: DifyWorld) {
  return skipBlockedPrecondition(
    world,
    'Agent v2 workflow task output deletion consistency is not available: deleting an output from the list currently leaves the Prompt token without a stable user-visible invalid-reference state.',
    {
      owner: 'product',
      remediation:
        'Define whether deletion should sync the Prompt token, block deletion, or expose an invalid-reference state before enabling this scenario.',
    },
  )
}

Given(
  'Agent v2 workflow task output reference deletion consistency is available',
  async function (this: DifyWorld) {
    return skipWorkflowTaskOutputReferenceDeletionConsistency(this)
  },
)

Then(
  'Agent v2 workflow task output reference deletion consistency should be available',
  async function (this: DifyWorld) {
    return skipWorkflowTaskOutputReferenceDeletionConsistency(this)
  },
)
