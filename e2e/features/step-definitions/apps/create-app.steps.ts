import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { openBlankAppCreation } from '../../../support/apps'
import { createE2EResourceName } from '../../../support/naming'

const appModeByType: Record<string, string> = {
  Agent: 'agent-chat',
  Chatbot: 'chat',
  Chatflow: 'advanced-chat',
  'Text Generator': 'completion',
  Workflow: 'workflow',
}

const getLatestCreatedAppId = (world: DifyWorld) => {
  const appId = world.createdAppIds.at(-1)
  if (!appId) throw new Error('No created app ID was recorded from the UI response.')

  return appId
}

When('I start creating a blank app', async function (this: DifyWorld) {
  await openBlankAppCreation(this.getPage())
})

When('I enter a unique E2E app name', async function (this: DifyWorld) {
  const appName = createE2EResourceName('App')
  this.lastCreatedAppName = appName
  await this.getPage().getByPlaceholder('Give your app a name').fill(appName)
})

When('I confirm app creation', async function (this: DifyWorld) {
  const page = this.getPage()
  const createButton = page.getByRole('dialog').getByRole('button', { name: /^Create(?:\s|$)/ })
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/console/api/apps'),
  )

  await expect(createButton).toBeEnabled()
  await createButton.click()

  const response = await responsePromise
  expect(response.ok()).toBe(true)
  const createdApp = (await response.json()) as { id?: string; mode?: string }
  if (!createdApp.id) throw new Error('Create app response did not include an app ID.')

  const expectedMode = this.lastSelectedAppType
    ? appModeByType[this.lastSelectedAppType]
    : undefined
  if (expectedMode) expect(createdApp.mode).toBe(expectedMode)
  this.createdAppIds.push(createdApp.id)
})

When('I select the {string} app type', async function (this: DifyWorld, appType: string) {
  const dialog = this.getPage().getByRole('dialog')
  const appTypeCard = dialog.getByRole('button', {
    name: new RegExp(`^${appType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
  })

  await expect(appTypeCard).toBeVisible()
  await appTypeCard.click()
  this.lastSelectedAppType = appType
})

When('I expand the beginner app types', async function (this: DifyWorld) {
  const page = this.getPage()
  const toggle = page.getByRole('button', { name: 'More basic app types' })

  await expect(toggle).toBeVisible()
  await toggle.click()
})

Then('I should land on the app editor', async function (this: DifyWorld) {
  const appId = getLatestCreatedAppId(this)
  await expect(this.getPage()).toHaveURL(
    new RegExp(`/app/${appId}/(workflow|configuration)(?:\\?.*)?$`),
  )
})

Then('I should land on the workflow editor', async function (this: DifyWorld) {
  const appId = getLatestCreatedAppId(this)
  await expect(this.getPage()).toHaveURL(new RegExp(`/app/${appId}/workflow(?:\\?.*)?$`))
})

Then('I should land on the app configuration page', async function (this: DifyWorld) {
  const appId = getLatestCreatedAppId(this)
  await expect(this.getPage()).toHaveURL(new RegExp(`/app/${appId}/configuration(?:\\?.*)?$`))
})
