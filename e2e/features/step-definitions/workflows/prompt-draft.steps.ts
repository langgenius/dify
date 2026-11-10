import type { DifyWorld } from '../../support/world.ts'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import * as z from 'zod'
import { createTestApp } from '../../../support/api/apps.ts'
import { createE2EResourceName } from '../../../support/naming.ts'
import { observeWorkflowDraftNetwork } from '../../../support/workflow-draft-network.ts'

const originalPrompt = 'Original prompt for the workflow. '.repeat(24).trim()
const editedPrompt = 'Keep this edited instruction after reconnect. '.repeat(54).trim()
const nodeId = 'e2e-llm'
const states = new WeakMap<
  DifyWorld,
  {
    appId: string
    collaboration: boolean
    network: Awaited<ReturnType<typeof observeWorkflowDraftNetwork>>
    savedRevision?: { hash: string; updatedAt: number }
  }
>()

const zGraph = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      data: z.object({
        prompt_template: z.array(z.object({ role: z.string(), text: z.string() })).optional(),
      }),
    }),
  ),
})

function state(world: DifyWorld) {
  const current = states.get(world)
  if (!current) throw new Error('Create the Chatflow before exercising its draft.')
  return current
}

async function getSavedPrompt(world: DifyWorld) {
  const draft = await world.getConsoleClient().apps.byAppId.workflows.draft.get({
    params: { app_id: state(world).appId },
  })
  const prompt = zGraph
    .parse(draft.graph)
    .nodes.find((node) => node.id === nodeId)
    ?.data.prompt_template?.find((item) => item.role === 'system')?.text
  return { prompt, hash: draft.hash, updatedAt: draft.updated_at, epoch: draft.loro_draft_epoch }
}

async function openPromptEditor(world: DifyWorld) {
  const page = world.getPage()
  const node = page.getByTestId(`rf__node-${nodeId}`)
  await expect(node).toBeVisible({ timeout: 30_000 })
  await node.click()
  const editor = page.locator('[data-lexical-editor="true"]')
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

async function editPrompt(world: DifyWorld) {
  const editor = world.getPage().locator('[data-lexical-editor="true"]')
  await expect(editor).toBeEditable()
  await editor.fill(editedPrompt)
  await expect(editor).toHaveText(editedPrompt)
}

Given(
  /^a Chatflow with a saved LLM prompt and collaboration (enabled|disabled)$/,
  async function (this: DifyWorld, mode: 'enabled' | 'disabled') {
    const client = this.getConsoleClient()
    const collaboration = mode === 'enabled'
    const features = await client.features.get()
    expect(features.workflow_collaboration_enabled).toBe(collaboration)
    const app = await createTestApp(
      client,
      createE2EResourceName('App', 'Prompt draft'),
      'advanced-chat',
    )
    this.createdAppIds.push(app.id)
    this.lastCreatedAppName = app.name
    const network = await observeWorkflowDraftNetwork(this.getPage())
    states.set(this, { appId: app.id, collaboration, network })
    await client.apps.byAppId.workflows.draft.post({
      params: { app_id: app.id },
      body: {
        graph: {
          nodes: [
            {
              id: 'start',
              type: 'custom',
              position: { x: 40, y: 160 },
              data: { type: 'start', title: 'Start', variables: [] },
            },
            {
              id: nodeId,
              type: 'custom',
              position: { x: 360, y: 160 },
              data: {
                type: 'llm',
                title: 'Draft prompt',
                model: {
                  provider: 'langgenius/openai/openai',
                  name: 'gpt-4o-mini',
                  mode: 'chat',
                  completion_params: {},
                },
                prompt_template: [{ role: 'system', text: originalPrompt }],
                context: { enabled: false, variable_selector: [] },
                vision: { enabled: false },
                variables: [],
              },
            },
          ],
          edges: [
            {
              id: 'start-llm',
              type: 'custom',
              source: 'start',
              target: nodeId,
              sourceHandle: 'source',
              targetHandle: 'target',
            },
          ],
          viewport: { x: 0, y: 0, zoom: 0.8 },
        },
        features: {},
        conversation_variables: [],
      },
    })
  },
)

When('I open the LLM prompt editor', async function (this: DifyWorld) {
  const { collaboration, network } = state(this)
  if (collaboration)
    await expect.poll(network.confirmedSyncs, { timeout: 40_000 }).toBeGreaterThan(0)
  await expect(await openPromptEditor(this)).toHaveText(originalPrompt)
})

When('I edit the LLM prompt', async function (this: DifyWorld) {
  await editPrompt(this)
})

When(
  /^I edit the prompt and (interrupt its upload|lose its successful save confirmation)$/,
  async function (this: DifyWorld, failure: string) {
    const { network } = state(this)
    network.interruptNext(failure === 'interrupt its upload' ? 'upload' : 'acknowledgement')
    await editPrompt(this)
    await expect.poll(network.faultObserved).toBe(true)
  },
)

Then('the server should still have the original prompt', async function (this: DifyWorld) {
  expect((await getSavedPrompt(this)).prompt).toBe(originalPrompt)
})

Then('the server should already have the edited prompt', async function (this: DifyWorld) {
  const saved = await getSavedPrompt(this)
  expect(saved.prompt).toBe(editedPrompt)
  state(this).savedRevision = { hash: saved.hash, updatedAt: saved.updatedAt }
})

When(
  'I reopen the LLM prompt editor while the collaboration connection is unavailable',
  async function (this: DifyWorld) {
    await this.getPage().reload()
    await openPromptEditor(this)
  },
)

When('I reload the Chatflow prompt editor', async function (this: DifyWorld) {
  await this.getPage().reload()
  await openPromptEditor(this)
})

Then('the edited LLM prompt should still be visible', async function (this: DifyWorld) {
  await expect(this.getPage().locator('[data-lexical-editor="true"]')).toHaveText(editedPrompt)
})

When('the collaboration connection returns', function (this: DifyWorld) {
  state(this).network.resume()
})

When(
  'I reopen the editor after the collaboration connection returns',
  async function (this: DifyWorld) {
    state(this).network.resume()
    await this.getPage().reload()
    await openPromptEditor(this)
  },
)

function saveStatus(world: DifyWorld) {
  return world.getPage().getByRole('status', { name: 'Workflow save status' })
}

Then('the edited LLM prompt should be durably saved', async function (this: DifyWorld) {
  const { network } = state(this)
  await expect.poll(network.confirmedUploads, { timeout: 20_000 }).toBeGreaterThan(0)
  expect((await getSavedPrompt(this)).prompt).toBe(editedPrompt)
  await expect(saveStatus(this)).not.toContainText('Syncing data')
  expect(network.httpSaves).toHaveLength(0)
})

Then(
  'the retried prompt save should confirm the same stored revision',
  async function (this: DifyWorld) {
    const { network, savedRevision } = state(this)
    if (!savedRevision)
      throw new Error('Read the revision that committed before losing the acknowledgement.')
    await expect.poll(network.confirmedUploads, { timeout: 20_000 }).toBeGreaterThan(0)
    expect(await getSavedPrompt(this)).toMatchObject({ ...savedRevision, prompt: editedPrompt })
    await expect(saveStatus(this)).not.toContainText('Syncing data')
    expect(network.httpSaves).toHaveLength(0)
  },
)

Then(
  'the edited LLM prompt should be saved through the ordinary HTTP draft request',
  async function (this: DifyWorld) {
    const { network } = state(this)
    await expect.poll(() => network.httpSaves, { timeout: 20_000 }).toContain(200)
    await expect
      .poll(() => getSavedPrompt(this), { timeout: 20_000 })
      .toMatchObject({ prompt: editedPrompt, epoch: undefined })
    expect(network.socketCount()).toBe(0)
  },
)
