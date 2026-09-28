import type { CreateAppPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { DifyWorld } from '../../support/world.ts'
import { Then, When } from '@cucumber/cucumber'
import { zPostAppsResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { expect } from '@playwright/test'

const appModeByType: Record<string, CreateAppPayload['mode']> = {
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

const expectAppEditorContent = async (world: DifyWorld) => {
  await expect(world.getPage().getByRole('link', { name: 'Orchestrate' })).toBeVisible()
}

When('I create the {string} app from Studio', async function (this: DifyWorld, appType: string) {
  const expectedMode = appModeByType[appType]
  if (!expectedMode) throw new Error(`Unsupported Studio app type: ${appType}`)

  const page = this.getPage()
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/console/api/apps'),
  )

  await page.getByRole('button', { name: 'Create', exact: true }).click()
  if (appType === 'Agent' || appType === 'Text Generator' || appType === 'Chatbot')
    await page.getByRole('menuitem', { name: 'More app types' }).click()

  await page.getByRole('menuitem', { name: appType, exact: true }).click()

  if (appType === 'Workflow' || appType === 'Chatflow') {
    const starterTitle =
      appType === 'Workflow' ? 'Build your next workflow' : 'Build your next chatflow'
    const starter = page.getByRole('dialog', { name: starterTitle })
    const firstOutcome = await Promise.race([
      responsePromise.then(() => 'created' as const),
      starter.waitFor({ state: 'visible' }).then(() => 'starter' as const),
    ])
    if (firstOutcome === 'starter')
      await starter.getByRole('button', { name: 'Open a blank canvas' }).click()
  }

  const response = await responsePromise
  expect(response.ok()).toBe(true)
  const createdApp = zPostAppsResponse.parse(await response.json())
  if (!createdApp.id) throw new Error('Create app response did not include an app ID.')

  expect(createdApp.mode).toBe(expectedMode)
  this.createdAppIds.push(createdApp.id)
  this.lastCreatedAppName = createdApp.name
})

Then('I should land on the app editor', async function (this: DifyWorld) {
  const appId = getLatestCreatedAppId(this)
  await expect(this.getPage()).toHaveURL(
    new RegExp(`/app/${appId}/(workflow|configuration)(?:\\?.*)?$`),
  )
  await expectAppEditorContent(this)
})

Then('I should land on the workflow editor', async function (this: DifyWorld) {
  const appId = getLatestCreatedAppId(this)
  await expect(this.getPage()).toHaveURL(new RegExp(`/app/${appId}/workflow(?:\\?.*)?$`))
  await expectAppEditorContent(this)
})

Then('I should land on the app configuration page', async function (this: DifyWorld) {
  const appId = getLatestCreatedAppId(this)
  await expect(this.getPage()).toHaveURL(new RegExp(`/app/${appId}/configuration(?:\\?.*)?$`))
  await expectAppEditorContent(this)
})
