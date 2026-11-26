import type { Page } from '@playwright/test'
import type { DifyWorld } from '../../support/world.ts'
import { Buffer } from 'node:buffer'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { waitForAppsConsole } from '../../../support/apps.ts'
import {
  answerNodeId,
  answerTitle,
  canvasNodeByTitle,
  llmPromptPanel,
  nodeId,
  openCollaboratorSession,
  openLlmPromptPanel,
  originalPrompt,
  preparePromptDraft,
  readPromptDraft,
  workflowDraft as state,
  workflowCollaborator,
} from '../../../support/workflow-prompt-draft.ts'

const editedPrompt = 'Keep this edited instruction after reconnect. '.repeat(54).trim()
const offlineAnswerTitle = 'Unsynced answer title'
const publishedName = 'Published prompt'
const newerPrompt = 'A saved draft newer than the published prompt.'
const nextPrompt = 'An edit made after reconnecting to the replaced draft.'

function replacement(world: DifyWorld) {
  const fixture = state(world).replacement
  if (!fixture) throw new Error('Prepare the second editor and the replacement draft first.')
  return fixture
}

async function getSavedPrompt(world: DifyWorld) {
  const draft = await readPromptDraft(world)
  const { nodes } = draft.graph
  const prompt = nodes
    .find((node) => node.id === nodeId)
    ?.data.prompt_template?.find((item) => item.role === 'system')?.text
  return {
    prompt,
    answerTitle: nodes.find((node) => node.id === answerNodeId)?.data.title,
    epoch: draft.loro_draft_epoch,
  }
}

function promptEditor(page: Page) {
  return llmPromptPanel(page).getByRole('textbox').and(page.locator('[contenteditable="true"]'))
}

async function openPromptEditor(page: Page) {
  await openLlmPromptPanel(page)
  const editor = promptEditor(page)
  await expect(editor).toBeEditable()
  return editor
}

Given(
  /^a Chatflow with a saved LLM prompt and collaboration (enabled|disabled)$/,
  async function (this: DifyWorld, mode: 'enabled' | 'disabled') {
    await preparePromptDraft(this, mode === 'enabled')
  },
)

When('I open the LLM prompt editor', async function (this: DifyWorld) {
  await expect(await openPromptEditor(this.getPage())).toHaveText(originalPrompt)
})

When('I lose the collaboration connection', async function (this: DifyWorld) {
  await state(this).network.disconnect()
})

When('I edit the LLM prompt', async function (this: DifyWorld) {
  const editor = promptEditor(this.getPage())
  await editor.fill(editedPrompt)
  await expect(editor).toHaveText(editedPrompt)
})

Then('the server should still have the original prompt', async function (this: DifyWorld) {
  expect((await getSavedPrompt(this)).prompt).toBe(originalPrompt)
})

When('I reload the Chatflow prompt editor', async function (this: DifyWorld) {
  await this.getPage().reload({ waitUntil: 'domcontentloaded' })
  await openPromptEditor(this.getPage())
})

Then('the edited LLM prompt should still be visible', async function (this: DifyWorld) {
  await expect(promptEditor(this.getPage())).toHaveText(editedPrompt)
})

When('the collaboration connection returns', function (this: DifyWorld) {
  state(this).network.resume()
})

Then('the edited LLM prompt should be durably saved', async function (this: DifyWorld) {
  await expect
    .poll(async () => (await getSavedPrompt(this)).prompt, { timeout: 20_000 })
    .toBe(editedPrompt)
  expect(state(this).network.httpSaves).toHaveLength(0)
})

Given(
  'a Chatflow with a published LLM prompt and a second editor',
  async function (this: DifyWorld) {
    const app = await preparePromptDraft(this, true)
    const client = this.getConsoleClient()
    const params = { app_id: app.id }
    const { epoch } = await getSavedPrompt(this)
    if (!epoch) throw new Error('The collaborative draft needs an epoch.')

    await client.apps.byAppId.workflows.publish.post({
      params,
      body: { marked_name: publishedName, marked_comment: '' },
    })
    const exported = await client.apps.byAppId.export.get({ params, query: { format: 'yaml' } })
    if (!('data' in exported)) throw new Error('The original workflow should export as a YAML DSL.')
    await openCollaboratorSession(this)
    state(this).replacement = { oldEpoch: epoch, dsl: exported.data }
  },
)

When('the other editor opens the same Chatflow', async function (this: DifyWorld) {
  const { page } = workflowCollaborator(this)
  const appName = this.lastCreatedAppName
  if (!appName) throw new Error('Create the Chatflow first.')
  await page.goto('/apps', { waitUntil: 'domcontentloaded' })
  await waitForAppsConsole(page)
  await page.getByRole('main').getByRole('link', { name: appName, exact: true }).click()
  await expect(await openPromptEditor(page)).toHaveText(originalPrompt)
})

When('I save a newer LLM prompt', async function (this: DifyWorld) {
  const editor = await openPromptEditor(this.getPage())
  await editor.fill(newerPrompt)
  await expect
    .poll(async () => (await getSavedPrompt(this)).prompt, { timeout: 20_000 })
    .toBe(newerPrompt)
})

When('the other editor queues changes while disconnected', async function (this: DifyWorld) {
  const { page, network } = workflowCollaborator(this)
  const editor = promptEditor(page)
  await expect(editor).toHaveText(newerPrompt, { timeout: 20_000 })
  await network.disconnect()
  await editor.fill(editedPrompt)
  await expect(editor).toHaveText(editedPrompt)

  await llmPromptPanel(page).getByRole('button', { name: 'Close', exact: true }).click()
  await canvasNodeByTitle(page, answerTitle).click()
  const answerPanel = page.getByRole('region', { name: `${answerTitle} Node configuration panel` })
  const name = answerPanel.getByRole('textbox', { name: 'Node name' })
  await name.fill(offlineAnswerTitle)
  await name.press('Enter')
  await expect(canvasNodeByTitle(page, offlineAnswerTitle)).toBeVisible()
  expect(await getSavedPrompt(this)).toMatchObject({ prompt: newerPrompt, answerTitle })
})

When('I restore the published LLM prompt', async function (this: DifyWorld) {
  const page = this.getPage()
  await page.getByRole('button', { name: 'Version History' }).click()
  await page.getByRole('button', { name: publishedName, exact: true }).click()
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
})

When('I overwrite the draft with its original DSL', async function (this: DifyWorld) {
  const page = this.getPage()
  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 20, y: 80 } })
  await page.getByRole('menuitem', { name: 'Import App' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import App' })
  await expect(dialog).toBeVisible()
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'original-workflow.yml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(replacement(this).dsl, 'utf8'),
  })
  await dialog.getByRole('button', { name: 'Overwrite and Import' }).click()
})

Then('the saved draft contains the replacement prompt', async function (this: DifyWorld) {
  await expect
    .poll(() => getSavedPrompt(this), { timeout: 20_000 })
    .toMatchObject({ prompt: originalPrompt, answerTitle, epoch: expect.any(String) })
  expect((await getSavedPrompt(this)).epoch).not.toBe(replacement(this).oldEpoch)
})

When('the other editor reconnects', function (this: DifyWorld) {
  workflowCollaborator(this).network.resume()
})

Then(
  'both editors see the replacement instead of the queued changes',
  async function (this: DifyWorld) {
    const { page, network } = workflowCollaborator(this)
    await expect(canvasNodeByTitle(page, answerTitle)).toBeVisible({ timeout: 25_000 })
    await expect(await openPromptEditor(page)).toHaveText(originalPrompt)
    await expect(await openPromptEditor(this.getPage())).toHaveText(originalPrompt)
    expect(await getSavedPrompt(this)).toMatchObject({ prompt: originalPrompt, answerTitle })
    expect(network.httpSaves).toHaveLength(0)
    expect(state(this).network.httpSaves).toHaveLength(0)
  },
)

Then('the other editor can save and reload a new prompt', async function (this: DifyWorld) {
  const { page } = workflowCollaborator(this)
  await promptEditor(page).fill(nextPrompt)
  await expect
    .poll(() => getSavedPrompt(this), { timeout: 20_000 })
    .toMatchObject({ prompt: nextPrompt, answerTitle })
  await expect(promptEditor(this.getPage())).toHaveText(nextPrompt, { timeout: 20_000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(await openPromptEditor(page)).toHaveText(nextPrompt)
})

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
