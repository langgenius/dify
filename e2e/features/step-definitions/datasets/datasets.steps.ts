import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestDataset } from '../../../support/api'

Given('there is an existing E2E dataset available for testing', async function (this: DifyWorld) {
  const dataset = await createTestDataset(`E2E Dataset ${Date.now()}`)
  this.createdDatasetIds.push(dataset.id)
  this.lastCreatedDatasetName = dataset.name
})

When('I open the datasets page', async function (this: DifyWorld) {
  await this.getPage().goto('/datasets')
})

When('I click the create knowledge link', async function (this: DifyWorld) {
  await this.getPage().getByText('Create Knowledge').click()
})

When('I click the empty knowledge creation option', async function (this: DifyWorld) {
  await this.getPage().getByText('I want to create an empty Knowledge').click()
})

When('I enter a unique E2E dataset name', async function (this: DifyWorld) {
  const datasetName = `E2E Dataset ${Date.now()}`
  this.lastCreatedDatasetName = datasetName
  const dialog = this.getPage().getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill(datasetName)
})

When('I confirm empty dataset creation', async function (this: DifyWorld) {
  const dialog = this.getPage().getByRole('dialog')
  await dialog.getByRole('button', { name: 'Create' }).click()
})

When('I open the operations menu for the last created E2E dataset', async function (this: DifyWorld) {
  const datasetName = this.lastCreatedDatasetName
  if (!datasetName) {
    throw new Error(
      'No dataset name stored. Run "there is an existing E2E dataset available for testing" first.',
    )
  }

  const page = this.getPage()
  const datasetCard = page.locator(`div[title="${datasetName}"]`).locator('..').locator('..').locator('..')
  await datasetCard.hover()
  await datasetCard.getByRole('button', { name: 'Dataset operations' }).click()
})

When('I click {string} in the dataset operations menu', async function (this: DifyWorld, operation: string) {
  await this.getPage().getByRole('menuitem', { name: operation }).click()
})

When('I confirm the dataset deletion', async function (this: DifyWorld) {
  const dialog = this.getPage().getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirm' }).click()
})

Then('I should land on the dataset documents page', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/datasets\/[^/]+\/documents(?:\\?.*)?$/)
})

Then('the dataset should no longer appear on the datasets page', async function (this: DifyWorld) {
  const datasetName = this.lastCreatedDatasetName
  if (!datasetName) {
    throw new Error(
      'No dataset name stored. Run "there is an existing E2E dataset available for testing" first.',
    )
  }

  await expect(this.getPage().getByTitle(datasetName)).not.toBeVisible({
    timeout: 10_000,
  })
})

When('I enter a new dataset name', async function (this: DifyWorld) {
  const newName = `E2E Dataset Renamed ${Date.now()}`
  this.lastCreatedDatasetName = newName
  const dialog = this.getPage().getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill(newName)
})

When('I confirm the dataset rename', async function (this: DifyWorld) {
  const dialog = this.getPage().getByRole('dialog')
  await dialog.getByRole('button', { name: 'Save' }).click()
})

Then('the dataset should display the new name on the datasets page', async function (this: DifyWorld) {
  const datasetName = this.lastCreatedDatasetName
  if (!datasetName) {
    throw new Error(
      'No dataset name stored. Run "I enter a new dataset name" first.',
    )
  }

  await expect(this.getPage().getByTitle(datasetName)).toBeVisible({
    timeout: 10_000,
  })
})

Then('I should see the dataset in the list', async function (this: DifyWorld) {
  const datasetName = this.lastCreatedDatasetName
  if (!datasetName) {
    throw new Error(
      'No dataset name stored. Run "there is an existing E2E dataset available for testing" first.',
    )
  }

  await expect(this.getPage().getByTitle(datasetName)).toBeVisible({
    timeout: 10_000,
  })
})

Then('the dataset count should be at least {int}', async function (this: DifyWorld, minCount: number) {
  const datasetCards = this.getPage().locator('div[title^="E2E Dataset"]')
  await expect(datasetCards).toHaveCount(minCount, { timeout: 10_000 })
})
