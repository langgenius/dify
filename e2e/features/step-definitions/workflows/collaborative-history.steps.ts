import type { Page } from '@playwright/test'
import type { DifyWorld } from '../../support/world.ts'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import {
  answerNodeId,
  answerTitle,
  canvasNodeByTitle,
  nodeId,
  openCollaboratorSession,
  preparePromptDraft,
  readPromptDraft,
  workflowCollaborator,
  workflowDraft,
} from '../../../support/workflow-prompt-draft.ts'

const prompts = [
  { id: 'system-message', role: 'system', text: 'Initial system' },
  { id: 'user-message', role: 'user', text: 'Initial user' },
]
function editors(world: DifyWorld) {
  return [world.getPage(), workflowCollaborator(world).page]
}

function actingEditor(world: DifyWorld, actor: string) {
  return actor === 'I' ? world.getPage() : workflowCollaborator(world).page
}

async function openLlmPanel(page: Page, title = 'Draft prompt') {
  const panel = page.getByRole('region', { name: `${title} Node configuration panel` })
  if (!(await panel.isVisible())) await canvasNodeByTitle(page, title).click()
  await expect(panel).toBeVisible()
  return panel
}

async function expectNodeTitle(world: DifyWorld, expected: string) {
  for (const page of editors(world))
    await expect(canvasNodeByTitle(page, expected)).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(
      async () => {
        const { nodes } = (await readPromptDraft(world)).graph
        return nodes.find((node) => node.id === nodeId)?.data.title
      },
      { timeout: 20_000 },
    )
    .toBe(expected)
}

async function expectAnswerConnection(world: DifyWorld, present: boolean) {
  for (const page of editors(world)) {
    const node = canvasNodeByTitle(page, answerTitle)
    const edge = page.getByRole('button', {
      name: `Connection from Draft prompt to ${answerTitle}`,
      exact: true,
    })
    await expect(node).toHaveCount(present ? 1 : 0, { timeout: 20_000 })
    await expect(edge).toHaveCount(present ? 1 : 0, { timeout: 20_000 })
  }
  await expect
    .poll(
      async () => {
        const { nodes, edges } = (await readPromptDraft(world)).graph
        return {
          answerNodes: nodes.filter((node) => node.id === answerNodeId).length,
          connections: edges.filter(
            (edge) => edge.source === nodeId && edge.target === answerNodeId,
          ).length,
        }
      },
      { timeout: 20_000 },
    )
    .toEqual({ answerNodes: present ? 1 : 0, connections: present ? 1 : 0 })
}

Given(
  'two workspace editors open a Chatflow with system and user prompts',
  async function (this: DifyWorld) {
    const app = await preparePromptDraft(this, true, prompts)
    const draft = workflowDraft(this)
    const peer = await openCollaboratorSession(this)
    draft.collaborator = peer
    await Promise.all(
      [{ page: this.getPage(), network: draft.network }, peer].map(async ({ page, network }) => {
        await page.goto(`/app/${app.id}/workflow`, { waitUntil: 'domcontentloaded' })
        await expect.poll(network.confirmedSyncs, { timeout: 40_000 }).toBeGreaterThan(0)
        await openLlmPanel(page)
        await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
      }),
    )
  },
)

When(
  /^(I|the other editor) changes? the prompt "([^"]+)" to "([^"]+)"$/,
  async function (this: DifyWorld, actor: string, before: string, after: string) {
    const page = actingEditor(this, actor)
    const panel = await openLlmPanel(page)
    await panel.getByRole('textbox').filter({ hasText: before }).fill(after)
    for (const editor of editors(this)) {
      const editorPanel = await openLlmPanel(editor)
      await expect(editorPanel.getByRole('textbox').filter({ hasText: after })).toHaveText(after, {
        timeout: 20_000,
      })
    }
  },
)

When(
  /^(I|the other editor) renames? the node "([^"]+)" to "([^"]+)"$/,
  async function (this: DifyWorld, actor: string, before: string, after: string) {
    const page = actingEditor(this, actor)
    await openLlmPanel(page, before)
    const name = page.getByRole('textbox', { name: 'Node name' })
    await name.fill(after)
    await name.press('Enter')
    await expectNodeTitle(this, after)
  },
)

When(
  /^(I|the other editor) (undo|redo)(?:es)? (?:my|their) last canvas change$/,
  async function (this: DifyWorld, actor: string, action: string) {
    const page = actingEditor(this, actor)
    const undo = action === 'undo'
    await page.getByRole('button', { name: undo ? 'Undo' : 'Redo', exact: true }).click()
    await expect(
      page.getByRole('button', { name: undo ? 'Redo' : 'Undo', exact: true }),
    ).toBeEnabled()
  },
)

When('both editors reload the Chatflow', async function (this: DifyWorld) {
  await Promise.all(editors(this).map((page) => page.reload({ waitUntil: 'domcontentloaded' })))
})

Then(
  'both editors and the saved draft show the prompts {string} and {string}',
  async function (this: DifyWorld, system: string, user: string) {
    for (const page of editors(this)) {
      const panel = await openLlmPanel(page)
      for (const text of [system, user])
        await expect(panel.getByRole('textbox').filter({ hasText: text })).toHaveText(text, {
          timeout: 20_000,
        })
    }
    await expect
      .poll(
        async () => {
          const { nodes } = (await readPromptDraft(this)).graph
          return nodes.find((node) => node.id === nodeId)?.data.prompt_template
        },
        { timeout: 20_000 },
      )
      .toEqual([
        { role: 'system', text: system },
        { role: 'user', text: user },
      ])
  },
)

Then(
  'both editors and the saved draft show the LLM node named {string}',
  async function (this: DifyWorld, title: string) {
    await expectNodeTitle(this, title)
  },
)

When('I delete the answer node from the canvas', async function (this: DifyWorld) {
  const page = this.getPage()
  const panel = await openLlmPanel(page)
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await canvasNodeByTitle(page, answerTitle).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^Delete\b/ }).click()
  await expectAnswerConnection(this, false)
})

Then(
  /^both editors and the saved draft (include|omit) the answer node and its connection$/,
  async function (this: DifyWorld, mode: string) {
    await expectAnswerConnection(this, mode === 'include')
  },
)
