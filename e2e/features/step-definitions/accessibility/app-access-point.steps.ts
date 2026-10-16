import type { Page } from '@playwright/test'
import type { DifyWorld } from '../../support/world.ts'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

const getAccessPointDialog = (page: Page, surface: string) => {
  if (surface === 'API Key') {
    return {
      dialog: page.getByRole('dialog', { name: 'API Key', exact: true }),
      trigger: page
        .getByRole('region', { name: 'Backend Service API', exact: true })
        .getByRole('button', { name: /^API Key/ }),
    }
  }
  if (surface === 'MCP configuration') {
    return {
      dialog: page.getByRole('dialog', {
        name: 'Add description to enable MCP server',
        exact: true,
      }),
      trigger: page
        .getByRole('region', { name: 'MCP Server', exact: true })
        .getByRole('button', { name: 'Add description', exact: true }),
    }
  }
  throw new Error(`Unknown app access point dialog "${surface}".`)
}

Then('the app access point page should be ready', async function (this: DifyWorld) {
  const page = this.getPage()
  await expect(page).toHaveURL(/\/app\/[^/]+\/access-point(?:\?.*)?$/)
  await expect(page.getByRole('heading', { name: 'Access Point', level: 1 })).toBeVisible()
  for (const name of ['Web App', 'Backend Service API', 'MCP Server']) {
    await expect(page.getByRole('region', { name, exact: true })).toBeVisible()
  }

  const accessPointCards = page
    .getByRole('main')
    .getByRole('region')
    .filter({ has: page.getByRole('heading', { level: 2 }) })
  await expect(accessPointCards.and(page.locator('[aria-busy="true"]'))).toHaveCount(0)
})

When(
  'I open the {string} app access point dialog',
  async function (this: DifyWorld, surface: string) {
    const { dialog, trigger } = getAccessPointDialog(this.getPage(), surface)
    await trigger.click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('opacity', '1')
    if (surface === 'API Key') {
      await expect(dialog.getByRole('button', { name: 'Create new Secret key' })).toBeVisible()
    }
  },
)

Then(
  'the {string} app access point dialog should support keyboard focus and dismissal',
  async function (this: DifyWorld, surface: string) {
    const page = this.getPage()
    const { dialog, trigger } = getAccessPointDialog(page, surface)
    await expect(dialog.locator(':focus')).toHaveCount(1)
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press(key)
        await expect(dialog.locator(':focus')).toHaveCount(1)
      }
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()

    await trigger.click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('opacity', '1')
  },
)
