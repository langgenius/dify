import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { waitForAppsConsole } from '../../../support/apps'
import { waitForConsoleHome } from '../../../support/home'

type MainPageConfig = {
  heading?: string
  path: string
  readyText?: string
}

const mainPages: Record<string, MainPageConfig> = {
  Agents: { path: '/agents', heading: 'Agents' },
  Home: { path: '/' },
  Integrations: { path: '/integrations/model-provider', readyText: 'Model Provider' },
  Knowledge: { path: '/datasets', heading: 'Knowledge' },
  Studio: { path: '/apps', heading: 'Studio' },
}

const getMainPageConfig = (pageName: string) => {
  const config = mainPages[pageName]
  if (!config)
    throw new Error(
      `Unknown main page "${pageName}". Expected one of: ${Object.keys(mainPages).join(', ')}.`,
    )

  return config
}

When('I open the default console entry', async function (this: DifyWorld) {
  await this.getPage().goto('/')
})

When('I open the apps console', async function (this: DifyWorld) {
  await this.getPage().goto('/apps')
})

When('I open the {string} main page', async function (this: DifyWorld, pageName: string) {
  await this.getPage().goto(getMainPageConfig(pageName).path)
})

When('I refresh the current page', async function (this: DifyWorld) {
  await this.getPage().reload()
})

Then('I should stay on the apps console', async function (this: DifyWorld) {
  await waitForAppsConsole(this.getPage())
})

Then('I should be on the {string} main page', async function (this: DifyWorld, pageName: string) {
  const page = this.getPage()
  const config = getMainPageConfig(pageName)

  await expect.poll(() => new URL(page.url()).pathname).toBe(config.path)
  await expect(page.getByRole('link', { name: pageName, exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  if (config.heading)
    await expect(page.getByRole('heading', { name: config.heading, exact: true })).toBeVisible()
  if (config.readyText)
    await expect(page.getByText(config.readyText, { exact: true }).first()).toBeVisible()
})

Then('I should be on the console home', async function (this: DifyWorld) {
  await waitForConsoleHome(this.getPage())
})

Then('I should be redirected to the signin page', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/signin(?:\?.*)?$/)
})

Then('I should see the {string} button', async function (this: DifyWorld, label: string) {
  await expect(this.getPage().getByRole('button', { name: label })).toBeVisible()
})

Then('I should not see the {string} button', async function (this: DifyWorld, label: string) {
  await expect(this.getPage().getByRole('button', { name: label })).not.toBeVisible()
})

Then('I should see the {string} text', async function (this: DifyWorld, text: string) {
  await expect(this.getPage().getByText(text)).toBeVisible({ timeout: 30_000 })
})
