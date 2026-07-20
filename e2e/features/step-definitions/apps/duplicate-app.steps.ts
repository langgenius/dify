import type { DifyWorld } from '../../support/world'
import { Given, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp } from '../../../support/api'
import { createE2EResourceName } from '../../../support/naming'

Given('there is an existing E2E app available for testing', async function (this: DifyWorld) {
  const name = createE2EResourceName('App', 'Test')
  const app = await createTestApp(name, 'completion')
  this.lastCreatedAppName = app.name
  this.createdAppIds.push(app.id)
})

When('I open the options menu for the last created E2E app', async function (this: DifyWorld) {
  const appName = this.lastCreatedAppName
  if (!appName) throw new Error('No app name stored. Run "I enter a unique E2E app name" first.')

  const page = this.getPage()
  const appLink = page.getByRole('link', { name: appName, exact: true })
  await expect(appLink).toBeVisible()
  await appLink.hover()
  await page.getByRole('button', { name: `More actions for ${appName}`, exact: true }).click()
})

When('I click {string} in the app options menu', async function (this: DifyWorld, label: string) {
  await this.getPage().getByRole('menuitem', { name: label }).click()
})

When('I confirm the app duplication', async function (this: DifyWorld) {
  const sourceAppId = this.createdAppIds.at(-1)
  if (!sourceAppId) throw new Error('No source app ID was recorded before duplication.')

  const page = this.getPage()
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith(`/console/api/apps/${sourceAppId}/copy`),
  )

  await page.getByRole('button', { exact: true, name: 'Duplicate' }).click()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  const copiedApp = (await response.json()) as { id?: string }
  if (!copiedApp.id) throw new Error('Duplicate app response did not include an app ID.')
  expect(copiedApp.id).not.toBe(sourceAppId)
  this.createdAppIds.push(copiedApp.id)
})
