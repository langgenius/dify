import type { Page } from '@playwright/test'
import type { DifyWorld } from '../../support/world.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import * as z from 'zod'
import { createTestApp } from '../../../support/api/apps.ts'
import { createConsoleClient } from '../../../support/api/console-client.ts'
import { waitForAppsConsole } from '../../../support/apps.ts'
import { createE2EResourceName } from '../../../support/naming.ts'
import { observeWorkflowDraftNetwork } from '../../../support/workflow-draft-network.ts'
import { baseURL, defaultLocale } from '../../../test-env.ts'

const originalPrompt = 'Original prompt for the workflow. '.repeat(24).trim()
const editedPrompt = 'Keep this edited instruction after reconnect. '.repeat(54).trim()
const nodeId = 'e2e-llm'
const answerNodeId = 'e2e-answer'
const answerTitle = 'Draft answer'
const offlineAnswerTitle = 'Unsynced answer title'
const publishedName = 'Published prompt'
const newerPrompt = 'A saved draft newer than the published prompt.'
const nextPrompt = 'An edit made after reconnecting to the replaced draft.'

const zGraph = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      data: z.object({
        title: z.string(),
        prompt_template: z.array(z.object({ role: z.string(), text: z.string() })).optional(),
      }),
    }),
  ),
})

function state(world: DifyWorld) {
  const current = world.workflowDraft
  if (!current) throw new Error('Create the Chatflow before exercising its draft.')
  return current
}

function replacement(world: DifyWorld) {
  const fixture = state(world).replacement
  if (!fixture) throw new Error('Prepare the second editor and the replacement draft first.')
  return fixture
}

async function getSavedPrompt(world: DifyWorld) {
  const draft = await world.getConsoleClient().apps.byAppId.workflows.draft.get({
    params: { app_id: state(world).appId },
  })
  const { nodes } = zGraph.parse(draft.graph)
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

function canvasNodeByTitle(page: Page, title: string) {
  return page.getByRole('button').filter({ has: page.getByText(title, { exact: true }) })
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

async function preparePromptDraft(world: DifyWorld, collaboration: boolean) {
  const client = world.getConsoleClient()
  const features = await client.features.get()
  expect(features.workflow_collaboration_enabled).toBe(collaboration)
  const app = await createTestApp(
    client,
    createE2EResourceName('App', 'Prompt draft'),
    'advanced-chat',
  )
  world.createdAppIds.push(app.id)
  world.lastCreatedAppName = app.name
  const network = await observeWorkflowDraftNetwork(world.getPage())
  world.workflowDraft = { appId: app.id, collaboration, network }
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
          {
            id: answerNodeId,
            type: 'custom',
            position: { x: 680, y: 160 },
            data: { type: 'answer', title: answerTitle, answer: 'A test answer.', variables: [] },
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
          {
            id: 'llm-answer',
            type: 'custom',
            source: nodeId,
            target: answerNodeId,
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
  return app
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
    await expect.poll(network.confirmedUploads, { timeout: 20_000 }).toBeGreaterThan(0)
    expect(await getSavedPrompt(this)).toMatchObject({ ...savedRevision, prompt: editedPrompt })
    await expect(saveStatus(this)).not.toContainText('Syncing data')
    expect(network.httpSaves).toHaveLength(0)
  },
)

async function openCollaboratorSession(world: DifyWorld) {
  const client = world.getConsoleClient()
  const email = `e2e-workflow-${randomUUID()}@example.com`
  const invitation = await client.workspaces.current.members.inviteEmail.post({
    body: { emails: [email], role: 'editor', language: defaultLocale },
  })
  const invited = invitation.invitation_results[0]
  if (invited?.status !== 'success') throw new Error('Could not invite the workflow collaborator.')
  const token = new URL(invited.url, baseURL).searchParams.get('token')
  if (!token) throw new Error('The collaborator invitation did not include a token.')

  const { accounts } = await client.workspaces.current.members.get()
  const member = accounts.find((account) => account.email === email)
  if (!member) throw new Error('The invited collaborator did not join the test workspace.')
  world.registerCleanup(async () => {
    await client.workspaces.current.members.byMemberId.delete({ params: { member_id: member.id } })
  })

  const browser = world.getPage().context().browser()
  if (!browser) throw new Error('The workflow collaborator needs an independent browser context.')
  const context = await browser.newContext({ baseURL, locale: defaultLocale })
  world.registerCleanup(() => context.close())
  const collaborator = createConsoleClient({
    requestContext: context.request,
    requireCsrfToken: false,
  })
  const { result } = await collaborator.login.post({
    body: {
      email,
      invite_token: token,
      password: Buffer.from(`E2eDraft${randomUUID()}`, 'utf8').toString('base64'),
    },
  })
  expect(result).toBe('success')
  await collaborator.activate.post({
    body: {
      token,
      name: 'E2E Workflow Editor',
      interface_language: defaultLocale,
      timezone: 'UTC',
    },
  })
  const profile = await collaborator.account.profile.get()
  expect(profile.id).toBe(member.id)

  const page = await context.newPage()
  const network = await observeWorkflowDraftNetwork(page)
  return { page, network }
}

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
    const collaborator = await openCollaboratorSession(this)
    state(this).replacement = { oldEpoch: epoch, dsl: exported.data, collaborator }
  },
)

When('the other editor opens the same Chatflow', async function (this: DifyWorld) {
  const { page, network } = replacement(this).collaborator
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
  const { page, network } = replacement(this).collaborator
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
  replacement(this).collaborator.network.resume()
})

Then(
  'both editors see the replacement instead of the queued changes',
  async function (this: DifyWorld) {
    const { page, network } = replacement(this).collaborator
    await expect.poll(network.rejectedStaleUploads, { timeout: 25_000 }).toBeGreaterThan(0)
    await expect(page.getByText(/Your unsynced edits are saved on this device/)).toBeVisible()
    await expect(await openPromptEditor(page)).toHaveText(originalPrompt)
    await expect(canvasNodeByTitle(page, answerTitle)).toBeVisible()
    await expect(this.getPage().locator('[data-lexical-editor="true"]')).toHaveText(originalPrompt)
    expect(await getSavedPrompt(this)).toMatchObject({ prompt: originalPrompt, answerTitle })
    expect(network.httpSaves).toHaveLength(0)
    expect(state(this).network.httpSaves).toHaveLength(0)
  },
)

Then('the other editor can save and reload a new prompt', async function (this: DifyWorld) {
  const { page, network } = replacement(this).collaborator
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
