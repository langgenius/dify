import type { CreateAppPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { DifyWorld } from '../../support/world.ts'
import { Then, When } from '@cucumber/cucumber'
import { zPostAppsResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { expect } from '@playwright/test'
import { createE2EResourceName } from '../../../support/naming.ts'

const appModeByType: Record<string, CreateAppPayload['mode']> = {
  Agent: 'agent-chat',
  Chatbot: 'chat',
  Chatflow: 'advanced-chat',
  'Text Generator': 'completion',
  Workflow: 'workflow',
}

// A losing branch of a Promise.race must not reject later as an unhandled rejection.
const neverSettles = () => new Promise<never>(() => {})

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

  const isBasicType = appType === 'Agent' || appType === 'Text Generator' || appType === 'Chatbot'
  // The Studio Create menu depends on the Dify Builder flag (off by default). With it off the
  // menu offers "Create from Blank", which opens the named create-app dialog. With it on the
  // menu lists app types and creates the app directly.
  const legacyBlank = page.getByRole('menuitem', { name: 'Create from Blank' })
  const builderEntry = page.getByRole('menuitem', {
    name: isBasicType ? 'More app types' : appType,
    exact: true,
  })
  const menuKind = await Promise.race([
    legacyBlank.waitFor({ state: 'visible' }).then(() => 'legacy' as const, neverSettles),
    builderEntry.waitFor({ state: 'visible' }).then(() => 'builder' as const, neverSettles),
  ])

  if (menuKind === 'legacy') {
    await legacyBlank.click()
    const dialog = page.getByRole('dialog')
    if (isBasicType) await dialog.getByRole('button', { name: 'More basic app types' }).click()
    const appTypeCard = dialog.getByRole('button', {
      name: new RegExp(`^${appType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
    })
    await appTypeCard.click()
    await dialog.getByPlaceholder('Give your app a name').fill(createE2EResourceName('App'))
    const createButton = dialog.getByRole('button', { name: /^Create(?:\s|$)/ })
    await expect(createButton).toBeEnabled()
    await createButton.click()
  } else {
    if (isBasicType) await builderEntry.click()
    await page.getByRole('menuitem', { name: appType, exact: true }).click()

    if (appType === 'Workflow' || appType === 'Chatflow') {
      const starterTitle =
        appType === 'Workflow' ? 'Build your next workflow' : 'Build your next chatflow'
      const starter = page.getByRole('dialog', { name: starterTitle })
      const firstOutcome = await Promise.race([
        responsePromise.then(() => 'created' as const),
        starter.waitFor({ state: 'visible' }).then(() => 'starter' as const, neverSettles),
      ])
      if (firstOutcome === 'starter')
        await starter.getByRole('button', { name: 'Open a blank canvas' }).click()
    }
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
