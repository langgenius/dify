import type { DifyWorld } from '../../support/world.ts'
import { readFile } from 'node:fs/promises'
import { Given, Then, When } from '@cucumber/cucumber'
import { zPostAppsImportsResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { expect } from '@playwright/test'
import { z } from 'zod'
import { createTestApp } from '../../../support/api/apps.ts'
import { syncRunnableWorkflowDraft } from '../../../support/api/workflows.ts'
import { waitForAppsConsole } from '../../../support/apps.ts'
import { createE2EResourceName } from '../../../support/naming.ts'

// Layout and selection state are not part of the portable workflow behavior.
const portableGraph = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      data: z.object({
        type: z.string(),
        title: z.string(),
        variables: z.array(z.unknown()).optional(),
        outputs: z.array(z.unknown()).optional(),
      }),
    }),
  ),
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      sourceHandle: z.string(),
      targetHandle: z.string(),
    }),
  ),
})

async function waitForImportedWorkflowEditor(world: DifyWorld) {
  const appId = world.appPackage?.importedAppId
  if (!appId) throw new Error('No imported workflow was recorded.')
  const page = world.getPage()
  await expect(page).toHaveURL(new RegExp(`/app/${appId}/workflow(?:\\?.*)?$`), {
    timeout: 30_000,
  })
  await expect(page.getByTestId('rf__node-end')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /^Test Run\b/ })).toBeEnabled()
}

Given(
  'a runnable workflow is available for an app package round trip',
  async function (this: DifyWorld) {
    const app = await createTestApp(
      this.getConsoleClient(),
      createE2EResourceName('Workflow', 'Package'),
      'workflow',
    )
    this.createdAppIds.push(app.id)
    this.lastCreatedAppName = app.name
    this.appPackage = { sourceAppId: app.id }
    await syncRunnableWorkflowDraft(this.getConsoleClient(), app.id)
  },
)

When('I export that workflow from Studio', async function (this: DifyWorld) {
  const name = this.lastCreatedAppName
  if (!name || !this.appPackage) throw new Error('No package source workflow was prepared.')

  const page = this.getPage()
  await page.goto('/apps')
  await waitForAppsConsole(page)
  const card = page
    .getByRole('region', { name: 'Studio' })
    .getByRole('listitem')
    .filter({
      has: page.getByRole('link', { name, exact: true }),
    })
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.getByRole('link', { name, exact: true }).hover()
  await card.getByRole('button', { name: `More actions for ${name}`, exact: true }).click()
  const actions = page.getByRole('menu')
  await expect(actions).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await actions.getByRole('menuitem', { name: 'Export App', exact: true }).click()
  const download = await downloaded
  await expect(actions).toBeHidden()
  expect(download.suggestedFilename()).toBe(`${name}.ifpkg`)
  await expect.poll(() => this.capturedDownloads.includes(download)).toBe(true)
})

When('I import the downloaded app package from Studio', async function (this: DifyWorld) {
  const state = this.appPackage
  const download = this.capturedDownloads.at(-1)
  if (!state || !download) throw new Error('No exported package is available to import.')

  const page = this.getPage()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  const createMenu = page.getByRole('menu')
  await expect(createMenu).toBeVisible()
  await createMenu.getByRole('menuitem', { name: /^Import App/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Import App', exact: true })
  await expect(dialog).toBeVisible()
  const choosingFile = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Browse', exact: true }).click()
  const chooser = await choosingFile
  await chooser.setFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/zip',
    buffer: await readFile(await download.path()),
  })
  await expect(
    dialog.getByRole('group', { name: download.suggestedFilename(), exact: true }),
  ).toBeVisible()
  const create = dialog.getByRole('button', { name: /^Create/ })
  await expect(create).toBeEnabled()
  const importing = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/console/api/apps/imports',
  )
  await create.click()
  const response = await importing
  expect(response.ok()).toBe(true)
  const imported = zPostAppsImportsResponse.parse(await response.json())
  if (imported.app_id) {
    this.createdAppIds.push(imported.app_id)
    state.importedAppId = imported.app_id
  }
  expect(imported.status).toBe('completed')
  expect(imported.app_mode).toBe('workflow')
  if (!state.importedAppId) throw new Error('The completed import did not return an app ID.')
  await expect(dialog).toBeHidden()
  await waitForImportedWorkflowEditor(this)
})

Then(
  'the imported app should preserve the workflow in a separate app',
  async function (this: DifyWorld) {
    const state = this.appPackage
    if (!state?.importedAppId) throw new Error('No imported workflow was recorded.')
    expect(state.importedAppId).not.toBe(state.sourceAppId)
    const client = this.getConsoleClient()
    const [source, imported] = await Promise.all([
      client.apps.byAppId.workflows.draft.get({ params: { app_id: state.sourceAppId } }),
      client.apps.byAppId.workflows.draft.get({ params: { app_id: state.importedAppId } }),
    ])
    expect(portableGraph.parse(imported.graph)).toEqual(portableGraph.parse(source.graph))
    expect(imported.conversation_variables).toEqual(source.conversation_variables)
    expect(imported.environment_variables).toEqual(source.environment_variables)
  },
)

When('I reload the imported workflow editor', async function (this: DifyWorld) {
  await this.getPage().reload()
  await waitForImportedWorkflowEditor(this)
})
