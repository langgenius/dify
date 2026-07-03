import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createConfiguredTestAgent, getAgentComposerDraft } from '../../agent-v2/support/agent'
import { agentBuilderFixedInputs, agentBuilderPreseededResources } from '../../agent-v2/support/agent-builder-resources'
import { createAgentSoulConfigWithDifyTool, normalAgentSoulConfig } from '../../agent-v2/support/agent-soul'
import { getPreseededOAuthToolConfig } from '../../agent-v2/support/preflight/agents'
import { asArray, asRecord, asString, skipBlockedPrecondition } from '../../agent-v2/support/preflight/common'
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

const getOAuth2ToolEntries = async (agentId: string) => {
  const draft = await getAgentComposerDraft(agentId)

  return asArray(asRecord(draft.agent_soul?.tools).dify_tools).filter((item) => {
    const record = asRecord(item)

    return record.credential_type === 'oauth2'
      && Boolean(asString(asRecord(record.credential_ref).id))
  })
}

const getOAuth2ToolDisplayName = async (world: DifyWorld) => {
  const [tool] = await getOAuth2ToolEntries(getCurrentAgentId(world))
  const record = asRecord(tool)
  const providerName = asString(record.provider) || asString(record.provider_id) || asString(record.plugin_id)
  const toolName = asString(record.name) || asString(record.tool_name)

  if (!providerName || !toolName)
    throw new Error('Agent v2 OAuth2 tool fixture must include provider and tool names.')

  return `${providerName} / ${toolName}`
}

const getPreseededOAuthToolAgent = (world: DifyWorld) => {
  const resource = world.agentBuilder.preflight.preseededResources[
    `${agentBuilderPreseededResources.oauthToolAgent} / OAuth2 tool credential`
  ]
  if (!resource || resource.kind !== 'agent') {
    throw new Error(
      `Preseeded Agent "${agentBuilderPreseededResources.oauthToolAgent}" OAuth2 tool credential fixture is not available. Run the matching preflight step first.`,
    )
  }

  return resource
}

const expectOAuth2CredentialPreserved = async (world: DifyWorld) => {
  const preseededAgent = getPreseededOAuthToolAgent(world)
  const expectedTool = await getPreseededOAuthToolConfig(preseededAgent.id)
  const expected = asRecord(expectedTool)
  const expectedCredentialRef = asRecord(expected.credential_ref)
  const expectedCredentialId = asString(expectedCredentialRef.id)
  const expectedProvider = asString(expected.provider_id) || asString(expected.provider) || asString(expected.plugin_id)
  const expectedToolName = asString(expected.tool_name) || asString(expected.name)

  await expect.poll(
    async () => {
      const tools = await getOAuth2ToolEntries(getCurrentAgentId(world))
      const matchingTool = tools.find((item) => {
        const record = asRecord(item)
        const provider = asString(record.provider_id) || asString(record.provider) || asString(record.plugin_id)
        const toolName = asString(record.tool_name) || asString(record.name)

        return provider === expectedProvider && toolName === expectedToolName
      })
      const record = asRecord(matchingTool)

      return {
        credentialId: asString(asRecord(record.credential_ref).id),
        credentialType: asString(record.credential_type),
      }
    },
    { timeout: 30_000 },
  ).toEqual({
    credentialId: expectedCredentialId,
    credentialType: 'oauth2',
  })
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

Given(
  'an Agent v2 test agent with the OAuth2 tool credential fixture has been created via API',
  async function (this: DifyWorld) {
    const preseededAgent = getPreseededOAuthToolAgent(this)
    const oauthTool = await getPreseededOAuthToolConfig(preseededAgent.id)
    const agent = await createConfiguredTestAgent({
      agentSoul: createAgentSoulConfigWithDifyTool(normalAgentSoulConfig, oauthTool),
    })

    this.createdAgentIds.push(agent.id)
    this.lastCreatedAgentName = agent.name
    this.lastCreatedAgentRole = agent.role ?? undefined
  },
)

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

Then(
  'I should see the Agent v2 OAuth2 tool authorized in the Tools section',
  async function (this: DifyWorld) {
    const toolsSection = getToolsSection(this)
    const displayName = await getOAuth2ToolDisplayName(this)

    await expectProviderToolActionVisible(toolsSection, displayName)
    await expect(toolsSection.getByRole('button', { exact: true, name: 'Not authorized' }))
      .not
      .toBeVisible()
  },
)

Then(
  'the Agent v2 OAuth2 tool credential should remain saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    await expectOAuth2CredentialPreserved(this)
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
