import type { AgentSoulDifyToolConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { sendAgentServiceApiChatMessage } from '../../agent-v2/support/access-point'
import { createConfiguredTestAgent, getAgentComposerDraft } from '../../agent-v2/support/agent'
import { agentBuilderExpectedTokens, agentBuilderFixedInputs, agentBuilderPreseededResources } from '../../agent-v2/support/agent-builder-resources'
import { createAgentSoulConfigWithDifyTool, createAgentSoulConfigWithModel, normalAgentSoulConfig } from '../../agent-v2/support/agent-soul'
import { getPreseededOAuthToolConfig } from '../../agent-v2/support/preflight/agents'
import { asArray, asRecord, asString } from '../../agent-v2/support/preflight/common'
import { hasToolEntry } from '../../agent-v2/support/preflight/tools'
import { getPreseededToolContract } from '../../agent-v2/support/tools'
import { expectProviderToolActionVisible, getCurrentAgentId } from './configure-helpers'

const getToolsSection = (world: DifyWorld) =>
  world.getPage().getByRole('region', { name: 'Tools' })

const getToolSelectorSearch = (world: DifyWorld) =>
  world.getPage().getByRole('textbox', { name: 'Search integrations...' })

const jsonReplaceRuntimePrompt = [
  'You are a Dify Agent E2E JSON tool verifier.',
  'When the user asks to verify JSON Replace, call the JSON Replace tool exactly once.',
  `Use content {"marker":"${agentBuilderExpectedTokens.jsonToolBefore}","nested":{"status":"keep"}}.`,
  'Use query $.marker and replace_value E2E_AFTER.',
  'After the tool returns, answer with the resulting JSON and include E2E_AFTER.',
].join(' ')

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

const jsonReplaceToolConfig = (world: DifyWorld): AgentSoulDifyToolConfig => {
  const tool = getPreseededToolContract(world, agentBuilderPreseededResources.jsonReplaceTool)

  return {
    credential_type: 'unauthorized',
    enabled: true,
    provider: tool.providerDisplayName,
    provider_id: tool.providerName,
    provider_type: 'builtin',
    runtime_parameters: {
      ensure_ascii: true,
      replace_model: 'value',
      value_decode: false,
    },
    tool_name: tool.toolName,
  }
}

const getServiceApiSseEvents = (body: unknown) =>
  asArray(asRecord(body).events).map(asRecord)

const getServiceApiEventData = (event: Record<string, unknown>) => asRecord(event.data)

const getServiceApiEventName = (event: Record<string, unknown>) => {
  const data = getServiceApiEventData(event)

  return asString(data.event) || asString(event.event)
}

const summarizeServiceApiRuntimeEvents = (body: unknown) =>
  getServiceApiSseEvents(body).map((event, index) => {
    const data = getServiceApiEventData(event)
    const observation = asString(data.observation)
    const answer = asString(data.answer)

    return {
      index,
      event: getServiceApiEventName(event),
      tool: asString(data.tool),
      hasToolInput: Boolean(asString(data.tool_input)),
      hasObservation: Boolean(observation),
      observation: observation.slice(0, 180),
      answer: answer.slice(0, 180),
    }
  })

const findJsonReplaceRuntimeThought = (body: unknown) =>
  getServiceApiSseEvents(body).find((event) => {
    const data = getServiceApiEventData(event)
    const toolInput = asString(data.tool_input)
    const observation = asString(data.observation)

    return getServiceApiEventName(event) === 'agent_thought'
      && asString(data.tool) === 'json_replace'
      && toolInput.includes(agentBuilderExpectedTokens.jsonToolBefore)
      && toolInput.includes('$.marker')
      && observation.includes(agentBuilderExpectedTokens.jsonToolAfter)
  })

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

Given(
  'a runnable Agent v2 test agent with the JSON Replace tool has been created via API',
  async function (this: DifyWorld) {
    if (!this.agentBuilder.preflight.stableModel)
      throw new Error('Create a JSON Replace runtime Agent after stable model preflight.')

    const agent = await createConfiguredTestAgent({
      agentSoul: createAgentSoulConfigWithDifyTool(
        createAgentSoulConfigWithModel(
          {
            ...normalAgentSoulConfig,
            prompt: {
              system_prompt: jsonReplaceRuntimePrompt,
            },
          },
          this.agentBuilder.preflight.stableModel,
        ),
        jsonReplaceToolConfig(this),
      ),
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

When('I send the Agent v2 Backend service API JSON Replace request', async function (this: DifyWorld) {
  const serviceApiBaseURL = this.agentBuilder.accessPoint.serviceApiBaseURL
  const apiKey = this.agentBuilder.accessPoint.generatedApiKey
  if (!serviceApiBaseURL)
    throw new Error('No Agent v2 service API endpoint found. Enable Backend service API first.')
  if (!apiKey)
    throw new Error('No Agent v2 API key found. Create a Backend service API key first.')

  this.agentBuilder.accessPoint.serviceApiResponse = await sendAgentServiceApiChatMessage({
    apiKey,
    query: [
      'Verify JSON Replace now.',
      `Replace ${agentBuilderExpectedTokens.jsonToolBefore} with ${agentBuilderExpectedTokens.jsonToolAfter}.`,
      `Return the JSON result and include ${agentBuilderExpectedTokens.jsonToolAfter}.`,
    ].join(' '),
    serviceApiBaseURL,
  })
})

Then(
  'the Agent v2 Backend service API response should include the JSON Replace E2E marker',
  async function (this: DifyWorld) {
    const response = this.agentBuilder.accessPoint.serviceApiResponse
    if (!response)
      throw new Error('No Agent v2 Backend service API response was recorded.')
    if (!response.ok)
      throw new Error(`Agent v2 Backend service API JSON Replace request failed with ${response.status}: ${JSON.stringify(response.body)}`)

    const jsonReplaceThought = findJsonReplaceRuntimeThought(response.body)
    if (!jsonReplaceThought) {
      throw new Error(
        [
          'Agent v2 Backend service API did not emit a JSON Replace agent_thought with matching tool input and observation.',
          `Received events: ${JSON.stringify(summarizeServiceApiRuntimeEvents(response.body))}`,
        ].join('\n'),
      )
    }

    const thought = getServiceApiEventData(jsonReplaceThought)
    expect(asString(thought.tool_input)).toContain(agentBuilderExpectedTokens.jsonToolBefore)
    expect(asString(thought.tool_input)).toContain('$.marker')
    expect(asString(thought.observation)).toContain(agentBuilderExpectedTokens.jsonToolAfter)
    expect(asString(asRecord(response.body).answer)).toContain(agentBuilderExpectedTokens.jsonToolAfter)
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
