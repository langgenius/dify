import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp } from '../../../support/api/apps'
import { getAppSiteURL } from '../../../support/api/web-apps'
import { syncRunnableWorkflowDraft } from '../../../support/api/workflows'
import { createE2EResourceName } from '../../../support/naming'
import { baseURL, defaultLocale } from '../../../test-env'

Given('a new runnable workflow app has been published', async function (this: DifyWorld) {
  const client = this.getConsoleClient()
  const app = await createTestApp(client, createE2EResourceName('App', 'WebApp'), 'workflow')
  this.createdAppIds.push(app.id)
  this.lastCreatedAppName = app.name
  await syncRunnableWorkflowDraft(client, app.id)
  await client.apps.byAppId.workflows.publish.post({
    body: { marked_comment: '', marked_name: '' },
    params: { app_id: app.id },
  })

  const appDetail = await client.apps.byAppId.get({ params: { app_id: app.id } })
  expect(appDetail.enable_site).toBe(true)
  this.shareURL = getAppSiteURL(appDetail)
})

When('I open the app information panel', async function (this: DifyWorld) {
  const appName = this.lastCreatedAppName
  if (!appName) {
    throw new Error('No app name available. Create an app before opening its information panel.')
  }

  await this.getPage().getByRole('button', { name: appName }).click()
})

const getWebAppSwitch = (world: DifyWorld) => {
  const webAppCard = world.getPage().getByRole('region', { name: 'Web App' })
  return webAppCard.getByRole('switch', { name: 'Web App' })
}

When('an anonymous visitor opens the Web App', async function (this: DifyWorld) {
  if (!this.shareURL) throw new Error('No Web App URL is available.')
  if (!this.context) throw new Error('Playwright browser context has not been initialized.')

  const browser = this.context.browser()
  if (!browser) throw new Error('Playwright browser has not been initialized.')

  const anonymousContext = await browser.newContext({ baseURL, locale: defaultLocale })
  this.registerCleanup(() => anonymousContext.close())
  this.sharedAppPage = await anonymousContext.newPage()
  await this.sharedAppPage.goto(this.shareURL, { timeout: 20_000 })
})

When('the anonymous visitor reloads the Web App', async function (this: DifyWorld) {
  if (!this.sharedAppPage) throw new Error('The anonymous visitor has not opened the Web App.')
  await this.sharedAppPage.reload({ timeout: 20_000 })
})

When('I disable the Web App', async function (this: DifyWorld) {
  const webAppSwitch = getWebAppSwitch(this)

  await expect(webAppSwitch).not.toHaveAttribute('aria-disabled', 'true', { timeout: 15_000 })
  await expect(webAppSwitch).toHaveAttribute('aria-checked', 'true')
  await webAppSwitch.click()
})

When('I enable the Web App', async function (this: DifyWorld) {
  const webAppSwitch = getWebAppSwitch(this)

  await expect(webAppSwitch).not.toHaveAttribute('aria-disabled', 'true', { timeout: 15_000 })
  await expect(webAppSwitch).toHaveAttribute('aria-checked', 'false')
  await webAppSwitch.click()
})

Then('the Web App should be in service', async function (this: DifyWorld) {
  const webAppCard = this.getPage().getByRole('region', { name: 'Web App' })
  await expect(webAppCard.getByText('In Service', { exact: true })).toBeVisible({
    timeout: 10_000,
  })
})

Then('the Web App should be disabled', async function (this: DifyWorld) {
  const webAppCard = this.getPage().getByRole('region', { name: 'Web App' })
  await expect(webAppCard.getByText('Disabled', { exact: true })).toBeVisible({
    timeout: 10_000,
  })
})

Then('the published workflow Web App should be accessible', async function (this: DifyWorld) {
  if (!this.sharedAppPage) throw new Error('The anonymous visitor has not opened the Web App.')
  await expect(this.sharedAppPage.getByRole('button', { name: 'Execute' })).toBeVisible({
    timeout: 15_000,
  })
})

Then('the published workflow Web App should be unavailable', async function (this: DifyWorld) {
  if (!this.sharedAppPage) throw new Error('The anonymous visitor has not opened the Web App.')
  await expect(this.sharedAppPage.getByRole('heading', { name: '404' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(this.sharedAppPage.getByText('App is unavailable', { exact: true })).toBeVisible()
})
