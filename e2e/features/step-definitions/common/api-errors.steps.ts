import type { DifyWorld } from '../../support/world.ts'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { openBlankAppCreation, waitForAppsConsole } from '../../../support/apps.ts'
import { createE2EResourceName } from '../../../support/naming.ts'
import {
  agentBuilderTestMaterials,
  getAgentBuilderTestMaterialPath,
} from '../../agent-v2/support/test-materials.ts'

Given('I have entered a new app name in the creation dialog', async function (this: DifyWorld) {
  const page = this.getPage()
  await page.goto('/apps')
  await waitForAppsConsole(page)
  await openBlankAppCreation(page)
  this.lastCreatedAppName = createE2EResourceName('App', 'error-recovery')
  await page.getByPlaceholder('Give your app a name').fill(this.lastCreatedAppName)
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Workflow\b/ })
    .click()
})

Given('both console session tokens have expired', async function (this: DifyWorld) {
  if (!this.context) throw new Error('Browser context is unavailable.')
  await this.context.clearCookies({ name: /^(?:__Host-)?(?:access_token|refresh_token)$/ })
})

When('I submit the app creation form with the expired session', async function (this: DifyWorld) {
  const page = this.getPage()
  const rejected = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/console/api/apps') &&
      response.status() === 401,
  )
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Create(?:\s|$)/ })
    .click()
  await rejected
})

Then('I should be asked to sign in again', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/signin(?:\?.*)?$/)
  await expect(this.getPage().getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
})

Given('the next app creation request will be denied by the API', async function (this: DifyWorld) {
  // Inject only the failure response. Bootstrap, browser code, and the form remain real.
  await this.getPage().route('**/console/api/apps', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await route.fulfill({
      status: 403,
      json: {
        code: 'forbidden',
        status: 403,
        message: 'You no longer have permission to create apps.',
      },
    })
  })
})

When('I submit the app creation form without permission', async function (this: DifyWorld) {
  const page = this.getPage()
  const rejected = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/console/api/apps') &&
      response.status() === 403,
  )
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Create(?:\s|$)/ })
    .click()
  await rejected
})

Then(
  'the app creation form should retain my input and allow another attempt',
  async function (this: DifyWorld) {
    if (!this.lastCreatedAppName) throw new Error('The app name has not been entered.')
    const dialog = this.getPage()
      .getByRole('dialog')
      .filter({ has: this.getPage().getByPlaceholder('Give your app a name') })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByPlaceholder('Give your app a name')).toHaveValue(
      this.lastCreatedAppName,
    )
    await expect(dialog.getByRole('button', { name: /^Create(?:\s|$)/ })).toBeEnabled()
  },
)

Then(
  'I should see exactly one error notification saying {string}',
  async function (this: DifyWorld, message: string) {
    const notifications = this.getPage().getByRole('region', { name: 'Notifications' })
    await expect(notifications.getByRole('dialog')).toHaveCount(1)
    await expect(notifications.getByText(message, { exact: true })).toBeVisible()
    await expect(this.getPage().getByText('[object Response]', { exact: false })).toHaveCount(0)
  },
)

Given(
  'I am editing a disposable Skill draft that was changed elsewhere',
  async function (this: DifyWorld) {
    const client = this.getConsoleClient()
    const skill = await client.workspaces.current.skills.post({
      body: {
        display_name: createE2EResourceName('Skill', 'save-conflict'),
      },
    })
    this.registerCleanup(async () => {
      await client.workspaces.current.skills.bySkillId.delete({
        params: { skill_id: skill.id },
        body: {},
      })
    })
    const manifest = skill.files?.find((file) => file.path === 'SKILL.md')
    if (!manifest?.content) throw new Error('The created Skill must have a text manifest.')
    const page = this.getPage()
    await page.goto(`/skills/${skill.id}`)
    await page.getByRole('button', { name: 'Source editor', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Source editor', exact: true })
    await expect(editor).toBeEditable()
    const originalContent = await editor.inputValue()
    this.skillConflict = {
      id: skill.id,
      localContent: `${originalContent}\nLocal unsaved instructions.`,
      serverContent: `${originalContent}\nInstructions saved by another editor.`,
    }
    const updated = await client.workspaces.current.skills.bySkillId.files.patch({
      params: { skill_id: skill.id },
      body: {
        operation: 'upsert_text',
        path: 'SKILL.md',
        content: this.skillConflict.serverContent,
        hash: manifest.hash,
        expected_updated_at: skill.updated_at,
      },
    })
    const savedManifest = updated.files?.find((file) => file.path === 'SKILL.md')
    if (!savedManifest?.content) throw new Error('The updated Skill must have a text manifest.')
    this.skillConflict.serverContent = savedManifest.content
  },
)

When('I edit the stale Skill draft', async function (this: DifyWorld) {
  if (!this.skillConflict) throw new Error('Skill conflict fixture is missing.')
  const page = this.getPage()
  const path = `/console/api/workspaces/current/skills/${this.skillConflict.id}/files`
  const rejected = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === path &&
      response.status() === 409,
  )
  await page
    .getByRole('textbox', { name: 'Source editor', exact: true })
    .fill(this.skillConflict.localContent)
  await rejected
})

Then(
  'I should be asked to load the latest Skill draft without losing my local text',
  async function (this: DifyWorld) {
    if (!this.skillConflict) throw new Error('Skill conflict fixture is missing.')
    const page = this.getPage()
    await expect(page.getByRole('alertdialog', { name: 'Load the latest draft?' })).toBeVisible()
    await expect(
      page.getByRole('textbox', { name: 'Source editor', exact: true, includeHidden: true }),
    ).toHaveValue(this.skillConflict.localContent)
    await expect(
      page.getByRole('region', { name: 'Notifications' }).getByRole('dialog'),
    ).toHaveCount(0)
  },
)

When('I confirm loading the latest Skill draft', async function (this: DifyWorld) {
  await this.getPage()
    .getByRole('alertdialog', { name: 'Load the latest draft?' })
    .getByRole('button', { name: 'Load latest draft' })
    .click()
})

Then('the Skill editor should show the other edit', async function (this: DifyWorld) {
  if (!this.skillConflict) throw new Error('Skill conflict fixture is missing.')
  await expect(this.getPage().getByRole('alertdialog')).toBeHidden()
  await expect(
    this.getPage().getByRole('textbox', { name: 'Source editor', exact: true }),
  ).toHaveValue(this.skillConflict.serverContent)
})

When('I upload an Agent file that the API rejects', async function (this: DifyWorld) {
  const page = this.getPage()
  // A server-side limit may be stricter than the client-side configured limit.
  await page.route('**/console/api/files/upload', async (route) => {
    await route.fulfill({
      status: 413,
      json: { code: 'file_too_large', message: 'File exceeds the server limit.', status: 413 },
    })
  })
  await page.getByRole('button', { name: 'Add file' }).click()
  const dialog = page.getByRole('dialog', { name: 'Upload file', exact: true })
  const chooser = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'browse' }).click()
  await (await chooser).setFiles(getAgentBuilderTestMaterialPath('smallFile'))
  const rejected = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/console/api/files/upload') &&
      response.status() === 413,
  )
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await rejected
})

Then(
  'the Agent upload dialog should retain the selected file and allow another attempt',
  async function (this: DifyWorld) {
    const dialog = this.getPage().getByRole('dialog', { name: 'Upload file', exact: true })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByText(agentBuilderTestMaterials.smallFile, { exact: true }),
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Upload', exact: true })).toBeEnabled()
  },
)
