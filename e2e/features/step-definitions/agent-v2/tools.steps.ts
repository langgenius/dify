import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { agentBuilderFixedInputs } from '../../agent-v2/support/agent-builder-resources'

const getToolsSection = (world: DifyWorld) =>
  world.getPage().getByRole('region', { name: 'Tools' })

const getToolSelectorSearch = (world: DifyWorld) =>
  world.getPage().getByRole('textbox', { name: 'Search integrations...' })

When(
  'I search for the missing Agent v2 tool from the Tools selector',
  async function (this: DifyWorld) {
    const toolsSection = getToolsSection(this)

    await expect(toolsSection).toBeVisible({ timeout: 30_000 })
    await toolsSection.getByRole('button', { name: 'Add tool' }).click()
    await this.getPage().getByRole('button', { name: /^Tool\b/ }).click()

    const search = getToolSelectorSearch(this)
    await expect(search).toBeVisible()
    await search.fill(agentBuilderFixedInputs.missingToolSearchWithSuffix)
  },
)

When('I clear the Agent v2 tool selector search', async function (this: DifyWorld) {
  const search = getToolSelectorSearch(this)

  await search.fill('')
})

Then('I should see the Agent v2 tool selector empty state', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByText('No integrations were found')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('link', { name: 'Requests to the community' })).toBeVisible()
  await expect(page.getByText(agentBuilderFixedInputs.missingToolSearchWithSuffix)).not.toBeVisible()
})

Then('I should see the Agent v2 tool selector ready for another search', async function (this: DifyWorld) {
  const page = this.getPage()
  const search = getToolSelectorSearch(this)

  await expect(search).toHaveValue('')
  await expect(page.getByText('No integrations were found')).not.toBeVisible()
  await expect(page.getByText('All tools')).toBeVisible()
})
