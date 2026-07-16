import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { adminCredentials } from '../../../fixtures/auth'
import { e2eBrowser } from '../../../test-env'

const getAccountMenuTrigger = (world: DifyWorld) =>
  world.getPage().getByRole('button', { name: 'Account' })

const getBlankAppTrigger = (world: DifyWorld) =>
  world.getPage().getByRole('main').getByRole('button', { name: 'Create from Blank' })

When(
  'I focus and activate the skip navigation link with the keyboard',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const skipLink = page.getByRole('link', { name: 'Skip to main content' })
    const nextClickableItemKey = e2eBrowser === 'webkit' ? 'Alt+Tab' : 'Tab'

    await page.keyboard.press(nextClickableItemKey)
    await expect(skipLink).toBeFocused()
    await page.keyboard.press('Enter')
  },
)

Then('the console main content should have keyboard focus', async function (this: DifyWorld) {
  await expect(this.getPage().getByRole('main')).toBeFocused()
})

When('I complete the sign-in form using only the keyboard', async function (this: DifyWorld) {
  const page = this.getPage()
  const email = page.getByLabel('Email address')
  const password = page.getByLabel('Password', { exact: true })
  const showPassword = page.getByRole('button', { name: 'Show password' })
  const submit = page.getByRole('button', { name: 'Sign in' })

  await expect(email).toBeVisible()
  for (let tabPresses = 0; tabPresses < 10; tabPresses += 1) {
    await page.keyboard.press('Tab')
    if (await email.evaluate((element) => element === document.activeElement)) break
  }
  await expect(email).toBeFocused()
  await page.keyboard.insertText(adminCredentials.email)

  await page.keyboard.press('Tab')
  await expect(password).toBeFocused()
  await page.keyboard.insertText(adminCredentials.password)

  await page.keyboard.press('Tab')
  await expect(showPassword).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(submit).toBeFocused()
  await page.keyboard.press('Enter')
})

When('I open and close the account menu using the keyboard', async function (this: DifyWorld) {
  const page = this.getPage()
  const trigger = getAccountMenuTrigger(this)

  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).not.toBeVisible()
})

Then('the account menu trigger should regain keyboard focus', async function (this: DifyWorld) {
  await expect(getAccountMenuTrigger(this)).toBeFocused()
})

When('I open and close the blank app dialog using the keyboard', async function (this: DifyWorld) {
  const page = this.getPage()
  const trigger = getBlankAppTrigger(this)

  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Create from Blank' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Create from Blank' })).not.toBeVisible()
})

Then('the blank app trigger should regain keyboard focus', async function (this: DifyWorld) {
  await expect(getBlankAppTrigger(this)).toBeFocused()
})
