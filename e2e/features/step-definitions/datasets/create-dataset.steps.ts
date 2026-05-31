import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

When('I open the datasets page', async function (this: DifyWorld) {
  await this.getPage().goto('/datasets')
})

When('I start creating a new dataset', async function (this: DifyWorld) {
  const page = this.getPage()
  await expect(page.getByText('Create Knowledge')).toBeVisible()
  await page.getByText('Create Knowledge').click()
})

When('I select {string}', async function (this: DifyWorld, option: string) {
  const page = this.getPage()
  await expect(page.getByText(option)).toBeVisible()
  await page.getByText(option).click()
})

When('I enter a unique E2E dataset name', async function (this: DifyWorld) {
  const datasetName = `E2E Dataset ${Date.now()}`
  this.lastCreatedDatasetName = datasetName
  await this.getPage().getByPlaceholder('Please input').fill(datasetName)
})

When('I confirm dataset creation', async function (this: DifyWorld) {
  const page = this.getPage()
  const createButton = page.getByRole('button', { name: 'Create' }).last()
  await expect(createButton).toBeEnabled()
  await createButton.click()
})

Then('I should land on the dataset document page', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/datasets\/[^/]+\/documents(?:\?.*)?$/)
})
