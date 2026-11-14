import type { DifyWorld } from '../../support/world.ts'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestDataset } from '../../../support/api/datasets.ts'
import { waitForKnowledgeConsole } from '../../../support/knowledge.ts'

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

Then('Evaluation is not offered from the resource details', async function (this: DifyWorld) {
  await expect(this.getPage().getByRole('link', { name: 'Evaluation', exact: true })).toHaveCount(0)
})
