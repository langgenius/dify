import type { DifyWorld } from '../../support/world.ts'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

const dialogEntries = {
  Branding: { card: 'Web App', button: 'Settings' },
  'Embed on website': { card: 'Web App', button: 'Embed Into Site' },
  'Add description to enable MCP server': { card: 'MCP Server', button: 'Add description' },
}

const getDialogEntry = (world: DifyWorld, dialogName: string) => {
  const entry = dialogEntries[dialogName as keyof typeof dialogEntries]
  if (!entry) throw new Error(`Unknown Access Point dialog "${dialogName}".`)

  return world
    .getPage()
    .getByRole('region', { name: entry.card, exact: true })
    .getByRole('button', { name: entry.button, exact: true })
}

Then('the Access Point page should be ready', async function (this: DifyWorld) {
  const page = this.getPage()
  await expect(page).toHaveURL(`/app/${this.createdAppIds.at(-1)}/access-point`)
  await expect(page.getByRole('heading', { name: 'Access Point', exact: true })).toBeVisible()
  await expect(page.getByRole('tabpanel', { name: 'Built-in', exact: true })).toBeVisible()
  for (const name of ['Web App', 'Backend Service API', 'MCP Server']) {
    const card = page.getByRole('region', { name, exact: true })
    await expect(card).toBeVisible()
    await expect(card).not.toHaveAttribute('aria-busy', 'true')
  }
})

When(
  'I open the {string} Access Point dialog',
  async function (this: DifyWorld, dialogName: string) {
    await getDialogEntry(this, dialogName).click()
    const dialog = this.getPage().getByRole('dialog', { name: dialogName, exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('opacity', '1')
  },
)

When(
  'I dismiss the {string} Access Point dialog with Escape',
  async function (this: DifyWorld, dialogName: string) {
    const dialog = this.getPage().getByRole('dialog', { name: dialogName, exact: true })
    await dialog.press('Escape')
    await expect(dialog).toBeHidden()
  },
)

Then(
  'focus should return to the {string} Access Point entry',
  async function (this: DifyWorld, dialogName: string) {
    await expect(getDialogEntry(this, dialogName)).toBeFocused()
  },
)
