import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestDataset } from '../../../support/api/datasets'
import { waitForKnowledgeConsole } from '../../../support/knowledge'

const getLatestCreatedId = (ids: string[], resource: string) => {
  const id = ids.at(-1)
  if (!id) throw new Error(`No ${resource} is available for evaluation.`)

  return id
}

Given('a general dataset has been created via API', async function (this: DifyWorld) {
  const dataset = await createTestDataset(this.getConsoleClient())
  this.createdDatasetIds.push(dataset.id)
})

When('I open the dataset from the knowledge list', async function (this: DifyWorld) {
  const datasetId = getLatestCreatedId(this.createdDatasetIds, 'dataset')
  const dataset = await this.getConsoleClient().datasets.byDatasetId.get({
    params: { dataset_id: datasetId },
  })
  const page = this.getPage()

  await page.goto('/datasets')
  await waitForKnowledgeConsole(page)

  const datasetName = page.getByRole('main').getByText(dataset.name, { exact: true })
  await expect(datasetName).toBeVisible()
  await datasetName.click()
  await expect(page).toHaveURL(new RegExp(`/datasets/${datasetId}/documents(?:\\?.*)?$`))
})

When('I open Evaluation from the resource details', async function (this: DifyWorld) {
  const evaluationLink = this.getPage().getByRole('link', { name: 'Evaluation', exact: true })
  await expect(evaluationLink).toBeVisible()
  await evaluationLink.click()
})

Then('the workflow app evaluation workspace should be ready', async function (this: DifyWorld) {
  const appId = getLatestCreatedId(this.createdAppIds, 'app')
  const page = this.getPage()

  await expect(page).toHaveURL(new RegExp(`/app/${appId}/evaluation(?:\\?.*)?$`))
  await expect(page.getByText('Judge Model', { exact: true })).toBeVisible()
  await expect(page.getByText('Judgment Conditions', { exact: true })).toBeVisible()
  await expect(page.getByText('Batch Test', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Download XLSX Template', exact: true }),
  ).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Upload & Run Test', exact: true })).toBeDisabled()
})

Then('the dataset evaluation workspace should be ready', async function (this: DifyWorld) {
  const datasetId = getLatestCreatedId(this.createdDatasetIds, 'dataset')
  const page = this.getPage()

  await expect(page).toHaveURL(new RegExp(`/datasets/${datasetId}/evaluation(?:\\?.*)?$`))
  await expect(page.getByRole('button', { name: 'Context Precision', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Context Recall', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Context Relevance', exact: true })).toBeVisible()
  await expect(page.getByText('No test history yet', { exact: true })).toBeVisible()
  await expect(page.getByText('No evaluation results yet.', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Download XLSX Template', exact: true }),
  ).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Upload & Run Test', exact: true })).toBeDisabled()
})

When('I download the evaluation XLSX template', async function (this: DifyWorld) {
  await this.getPage().getByRole('button', { name: 'Download XLSX Template', exact: true }).click()
})

Then(
  'an evaluation template named {string} should be downloaded',
  async function (this: DifyWorld, fileName: string) {
    await expect.poll(() => this.capturedDownloads.length, { timeout: 10_000 }).toBeGreaterThan(0)

    const download = this.capturedDownloads.at(-1)!
    expect(download.suggestedFilename()).toBe(fileName)
    await expect(download.failure()).resolves.toBeNull()
  },
)

When('I open the evaluation test history', async function (this: DifyWorld) {
  await this.getPage().getByRole('button', { name: 'Test History', exact: true }).click()
})

Then('the evaluation history should be empty', async function (this: DifyWorld) {
  await expect(this.getPage().getByText('No test history yet', { exact: true })).toBeVisible()
})
