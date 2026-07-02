import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { getAgentComposerDraft } from '../../agent-v2/support/agent'
import { agentBuilderFixedInputs, agentBuilderPreseededResources } from '../../agent-v2/support/agent-builder-resources'
import { asArray, asRecord, skipBlockedPrecondition } from '../../agent-v2/support/preflight/common'
import { hasToolEntry } from '../../agent-v2/support/preflight/tools'
import { getPreseededToolContract } from '../../agent-v2/support/tools'
import { expectProviderToolActionVisible, getCurrentAgentId } from './configure-helpers'

const getToolsSection = (world: DifyWorld) =>
  world.getPage().getByRole('region', { name: 'Tools' })

const getToolSelectorSearch = (world: DifyWorld) =>
  world.getPage().getByRole('textbox', { name: 'Search integrations...' })

const expectJsonReplaceToolDraft = async (world: DifyWorld) => {
  const agentId = getCurrentAgentId(world)
  const tool = getPreseededToolContract(world, agentBuilderPreseededResources.jsonReplaceTool)

  await expect.poll(
    async () => {
      const draft = await getAgentComposerDraft(agentId)
      const tools = asArray(asRecord(draft.agent_soul?.tools).dify_tools)

      return hasToolEntry(tools, tool)
    },
    { timeout: 30_000 },
  ).toBe(true)
}

async function skipJsonReplaceRuntimeVerification(world: DifyWorld) {
  return skipBlockedPrecondition(
    world,
    'Agent v2 JSON Replace runtime verification is blocked: the suite needs the JSON Process / JSON Replace runtime parameter contract and a deterministic published-runtime prompt before asserting tool execution.',
    {
      owner: 'test/seed',
      remediation: 'Seed the JSON Replace tool runtime contract, then verify execution through published Web app or Backend service API instead of Builder Preview.',
    },
  )
}

When(
  'I add the Agent Builder JSON Replace tool from the Tools selector',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const toolsSection = getToolsSection(this)

    await expect(toolsSection).toBeVisible({ timeout: 30_000 })
    await toolsSection.getByRole('button', { name: 'Add tool' }).click()
    await page.getByRole('button', { name: /^Tool\b/ }).click()

    const search = getToolSelectorSearch(this)
    await expect(search).toBeVisible()
    await search.fill('JSON Replace')

    await page.getByRole('button', { exact: true, name: 'JSON Replace' }).click()
    await expectProviderToolActionVisible(
      toolsSection,
      agentBuilderPreseededResources.jsonReplaceTool,
    )
  },
)

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

Given('Agent v2 JSON Replace runtime verification is available', async function (this: DifyWorld) {
  return skipJsonReplaceRuntimeVerification(this)
})

Then('Agent v2 JSON Replace runtime verification should be available', async function (this: DifyWorld) {
  return skipJsonReplaceRuntimeVerification(this)
})

Then(
  'the Agent v2 JSON Replace tool should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    await expectJsonReplaceToolDraft(this)
  },
)

Then(
  'I should see the Agent v2 JSON Replace tool in the Tools section',
  async function (this: DifyWorld) {
    await expectProviderToolActionVisible(
      getToolsSection(this),
      agentBuilderPreseededResources.jsonReplaceTool,
    )
    await expectJsonReplaceToolDraft(this)
  },
)

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
