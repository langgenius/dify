import type { Locator, Page } from '@playwright/test'
import type { DifyWorld } from '../../support/world.ts'
import { Buffer } from 'node:buffer'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { waitForAppsConsole } from '../../../support/apps.ts'
import { observeWorkflowDraftNetwork } from '../../../support/workflow-draft-network.ts'
import {
  answerNodeId,
  answerTitle,
  canvasNodeByTitle,
  nodeId,
  openCollaboratorSession,
  originalPrompt,
  preparePromptDraft,
  readPromptDraft,
  workflowDraft as state,
  workflowCollaborator,
} from '../../../support/workflow-prompt-draft.ts'

const editedPrompt = 'Keep this edited instruction after reconnect. '.repeat(54).trim()
const promptSuffix = ' Keep every word typed during sync.'

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
    hash: draft.hash,
    updatedAt: draft.updated_at,
    epoch: draft.loro_draft_epoch,
  }
}

async function openPromptEditor(page: Page) {
  const node = page.getByTestId(`rf__node-${nodeId}`)
  await expect(node).toBeVisible({ timeout: 30_000 })
  await node.click()
  const editor = page.locator('[data-lexical-editor="true"]')
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

async function tabTo(page: Page, target: Locator) {
  for (let tabs = 0; tabs < 100; tabs++) {
    if (await target.evaluate((element) => element === document.activeElement)) break
    await page.keyboard.press('Tab')
  }
  await expect(target).toBeFocused()
}

async function openFixtureApp(page: Page, appName: string | undefined) {
  if (!appName) throw new Error('Create the Chatflow first.')
  await page.goto('/apps', { waitUntil: 'domcontentloaded' })
  await waitForAppsConsole(page)
  await page.getByRole('main').getByRole('link', { name: appName, exact: true }).click()
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
    await preparePromptDraft(this, mode === 'enabled')
  },
)

When('I open the LLM prompt editor', async function (this: DifyWorld) {
  const { collaboration, network } = state(this)
  if (collaboration)
    await expect.poll(network.confirmedSyncs, { timeout: 40_000 }).toBeGreaterThan(0)
  await expect(await openPromptEditor(this.getPage())).toHaveText(originalPrompt)
})

When('I edit the LLM prompt', async function (this: DifyWorld) {
  await editPrompt(this)
})

When(
  'I continue typing in the LLM node before collaboration finishes connecting',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const { appId, network } = state(this)
    const heldJoin = network.holdNextJoin()
    await page.goto(`/app/${appId}/workflow`, { waitUntil: 'domcontentloaded' })
    const releaseJoin = await heldJoin
    const syncing = page.getByRole('status', { name: '', exact: true }).filter({
      hasText: 'Syncing data, just a few seconds.',
    })
    try {
      await expect(syncing).toBeVisible()
      await tabTo(page, canvasNodeByTitle(page, 'Draft prompt'))
      await page.keyboard.press('Enter')
      const panel = page.getByRole('region', { name: 'Draft prompt Node configuration panel' })
      const editor = panel.getByRole('textbox').filter({ hasText: originalPrompt })
      await expect(editor).toHaveText(originalPrompt)
      await tabTo(page, editor)
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.type(promptSuffix)
      await expect(editor).toHaveText(originalPrompt + promptSuffix)
      await expect(syncing).toBeVisible()
    } finally {
      releaseJoin()
    }
    await expect.poll(network.confirmedSyncs, { timeout: 40_000 }).toBeGreaterThan(0)
    await expect(syncing).toBeHidden()
  },
)

Then(
  'the complete prompt should be saved and survive reloading the editor',
  async function (this: DifyWorld) {
    const expected = originalPrompt + promptSuffix
    await expect
      .poll(async () => (await getSavedPrompt(this)).prompt, { timeout: 20_000 })
      .toBe(expected)
    const page = this.getPage()
    await page.reload()
    await expect(await openPromptEditor(page)).toHaveText(expected)
  },
)

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
  const { appId, network } = state(this)
  const profile = await this.getConsoleClient().account.profile.get()
  const scope = JSON.stringify([profile.id, appId, saved.epoch])
  await expect
    .poll(async () => (await readLocalDraft(this.getPage(), scope)).edits)
    .toBeGreaterThan(0)
  state(this).savedRevision = {
    hash: saved.hash,
    updatedAt: saved.updatedAt,
    confirmedSyncs: network.confirmedSyncs(),
    scope,
  }
})

When(
  'I reopen the LLM prompt editor while the collaboration connection is unavailable',
  async function (this: DifyWorld) {
    await openFixtureApp(this.getPage(), this.lastCreatedAppName)
    await openPromptEditor(this.getPage())
  },
)

When('I reload the Chatflow prompt editor', async function (this: DifyWorld) {
  await this.getPage().reload()
  await openPromptEditor(this.getPage())
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
    await openFixtureApp(this.getPage(), this.lastCreatedAppName)
    await openPromptEditor(this.getPage())
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
    const { hash, updatedAt, confirmedSyncs, scope } = savedRevision
    await expect.poll(network.confirmedSyncs, { timeout: 20_000 }).toBeGreaterThan(confirmedSyncs)
    await expect
      .poll(() => readLocalDraft(this.getPage(), scope))
      .toEqual({
        edits: 0,
        checkpoint: true,
        retired: false,
      })
    expect(await getSavedPrompt(this)).toMatchObject({ hash, updatedAt, prompt: editedPrompt })
    await expect(saveStatus(this)).not.toContainText('Syncing data')
    expect(network.httpSaves).toHaveLength(0)
  },
)

Given(
  /^a Chatflow with a published LLM prompt (and a second editor|open in two tabs)$/,
  async function (this: DifyWorld, session: string) {
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
    const collaborator = await (async () => {
      if (session === 'and a second editor') return openCollaboratorSession(this)
      const page = await this.getPage().context().newPage()
      this.registerCleanup(() => page.close())
      const network = await observeWorkflowDraftNetwork(page)
      const profile = await client.account.profile.get()
      return { page, network, accountId: profile.id }
    })()
    state(this).collaborator = collaborator
    state(this).replacement = { oldEpoch: epoch, dsl: exported.data }
  },
)

When('the other editor opens the same Chatflow', async function (this: DifyWorld) {
  const { page, network } = workflowCollaborator(this)
  await openFixtureApp(page, this.lastCreatedAppName)
  await expect.poll(network.confirmedSyncs, { timeout: 30_000 }).toBeGreaterThan(0)
  await expect(await openPromptEditor(page)).toHaveText(originalPrompt)
})

When('I save a newer LLM prompt', async function (this: DifyWorld) {
  const editor = await openPromptEditor(this.getPage())
  await editor.fill(newerPrompt)
  await expect
    .poll(() => getSavedPrompt(this), { timeout: 15_000 })
    .toMatchObject({
      prompt: newerPrompt,
    })
})

When('the other editor queues changes while disconnected', async function (this: DifyWorld) {
  const { page, network } = workflowCollaborator(this)
  const editor = page.locator('[data-lexical-editor="true"]')
  await expect(editor).toHaveText(newerPrompt)
  network.interruptNext('upload')
  await editor.fill(editedPrompt)
  await expect.poll(network.faultObserved).toBe(true)
  await expect(editor).toHaveText(editedPrompt)

  const promptPanel = page.getByRole('region', { name: 'Draft prompt Node configuration panel' })
  await promptPanel.getByRole('button', { name: 'Close', exact: true }).click()
  await canvasNodeByTitle(page, answerTitle).click()
  const name = page.getByRole('textbox', { name: 'Node name' })
  await name.fill(offlineAnswerTitle)
  await name.press('Enter')
  await expect(canvasNodeByTitle(page, offlineAnswerTitle)).toBeVisible()
  expect(await getSavedPrompt(this)).toMatchObject({
    prompt: newerPrompt,
    answerTitle,
  })
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
    .poll(() => getSavedPrompt(this), { timeout: 15_000 })
    .toMatchObject({
      prompt: originalPrompt,
      answerTitle,
    })
  const { epoch } = await getSavedPrompt(this)
  expect(epoch).toBeDefined()
  expect(epoch).not.toBe(replacement(this).oldEpoch)
  await expect(await openPromptEditor(this.getPage())).toHaveText(originalPrompt)
})

When('the other editor reconnects', function (this: DifyWorld) {
  workflowCollaborator(this).network.resume()
})

Then(
  'both editors see the replacement instead of the queued changes',
  async function (this: DifyWorld) {
    const { page, network } = workflowCollaborator(this)
    await expect
      .poll(() => network.rejectedEpochs.has(replacement(this).oldEpoch), { timeout: 25_000 })
      .toBe(true)
    await expect(
      page.getByText(/unconfirmed local edits from the old draft have been cleared/),
    ).toBeVisible()
    await expect(await openPromptEditor(page)).toHaveText(originalPrompt)
    await expect(canvasNodeByTitle(page, answerTitle)).toBeVisible()
    await expect(this.getPage().locator('[data-lexical-editor="true"]')).toHaveText(originalPrompt)
    expect(await getSavedPrompt(this)).toMatchObject({ prompt: originalPrompt, answerTitle })
    expect(network.httpSaves).toHaveLength(0)
    expect(state(this).network.httpSaves).toHaveLength(0)
    await expect
      .poll(() => readOldLocalDraft(this))
      .toEqual({ edits: 0, checkpoint: false, retired: true })
  },
)

async function readOldLocalDraft(world: DifyWorld) {
  const { oldEpoch } = replacement(world)
  const collaborator = workflowCollaborator(world)
  const scope = JSON.stringify([collaborator.accountId, state(world).appId, oldEpoch])
  return readLocalDraft(collaborator.page, scope)
}

async function readLocalDraft(page: Page, scope: string) {
  return page.evaluate(async (scope) => {
    const request = indexedDB.open('dify-workflow-loro', 1)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const request = db.transaction('drafts').objectStore('drafts').index('scope').getAll(scope)
      const records = await new Promise<{ kind: string }[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return {
        edits: records.filter((record) => record.kind === 'edit').length,
        checkpoint: records.some((record) => record.kind === 'checkpoint'),
        retired: records.some((record) => record.kind === 'retired'),
      }
    } finally {
      db.close()
    }
  }, scope)
}

Then('the old local draft is cleared across both tabs', async function (this: DifyWorld) {
  await expect(
    this.getPage().getByText(/unconfirmed local edits from the old draft have been cleared/),
  ).toBeVisible()
  await expect
    .poll(() => readOldLocalDraft(this))
    .toEqual({ edits: 0, checkpoint: false, retired: true })
})

When('the disconnected tab edits the old draft again', async function (this: DifyWorld) {
  const { page } = workflowCollaborator(this)
  const name = page.getByRole('textbox', { name: 'Node name' })
  await name.fill('Late edit from the old tab')
  await name.press('Enter')
  await expect(await openPromptEditor(page)).toHaveText(originalPrompt)
  expect(await readOldLocalDraft(this)).toEqual({ edits: 0, checkpoint: false, retired: true })
})

Then('both tabs keep the replacement after reconnect and reload', async function (this: DifyWorld) {
  const { page, network } = workflowCollaborator(this)
  const confirmed = network.confirmedSyncs()
  network.resume()
  await expect.poll(network.confirmedSyncs, { timeout: 25_000 }).toBeGreaterThan(confirmed)
  for (const tab of [this.getPage(), page]) {
    await tab.reload({ waitUntil: 'commit' })
    await expect(await openPromptEditor(tab)).toHaveText(originalPrompt)
    await expect(canvasNodeByTitle(tab, answerTitle)).toBeVisible()
  }
  expect(await getSavedPrompt(this)).toMatchObject({ prompt: originalPrompt, answerTitle })
  expect(await readOldLocalDraft(this)).toEqual({ edits: 0, checkpoint: false, retired: true })
  expect(network.httpSaves).toHaveLength(0)
  expect(state(this).network.httpSaves).toHaveLength(0)
})

Then('the other editor can save and reload a new prompt', async function (this: DifyWorld) {
  const { page, network } = workflowCollaborator(this)
  const confirmed = network.confirmedUploads()
  await page.locator('[data-lexical-editor="true"]').fill(nextPrompt)
  await expect.poll(network.confirmedUploads, { timeout: 15_000 }).toBeGreaterThan(confirmed)
  await expect.poll(() => getSavedPrompt(this)).toMatchObject({ prompt: nextPrompt, answerTitle })
  await expect(this.getPage().locator('[data-lexical-editor="true"]')).toHaveText(nextPrompt)
  await expect(page.getByRole('status', { name: 'Workflow save status' })).not.toContainText(
    'Syncing data',
  )
  await page.reload({ waitUntil: 'commit' })
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
