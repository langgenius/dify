import type { PostAgentByAgentIdCopyResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createE2EResourceName } from '../../../support/naming'
import {
  getAgentComposerDraft,
  getTestAgent,
} from '../../agent-v2/support/agent'
import { agentBuilderExpectedTokens, agentBuilderFixedInputs, agentBuilderPreseededResources } from '../../agent-v2/support/agent-builder-resources'
import { normalAgentPrompt } from '../../agent-v2/support/agent-soul'
import {
  asArray,
  asRecord,
  asString,
  skipBlockedPrecondition,
} from '../../agent-v2/support/preflight/common'
import { agentBuilderTestMaterials } from '../../agent-v2/support/test-materials'
import {
  expectProviderToolActionVisible,
  getCurrentAgentId,
  getPreseededAgent,
  openAgentKnowledgeRetrievalDialog,
} from './configure-helpers'

const getComposerInheritanceSnapshot = async (agentId: string) => {
  const draft = await getAgentComposerDraft(agentId)
  const soul = draft.agent_soul ?? {}
  const model = asRecord(soul.model)
  const prompt = asRecord(soul.prompt)
  const files = asArray(soul.config_files)
  const tools = asArray(asRecord(soul.tools).dify_tools)
  const knowledgeSets = asArray(asRecord(soul.knowledge).sets)

  return {
    fileNames: files.map(file => asString(asRecord(file).name)).filter(Boolean).sort(),
    knowledgeDatasetNames: knowledgeSets
      .flatMap(set => asArray(asRecord(set).datasets))
      .map(dataset => asString(asRecord(dataset).name))
      .filter(Boolean)
      .sort(),
    model: {
      name: asString(model.model),
      provider: asString(model.model_provider),
    },
    prompt: asString(prompt.system_prompt),
    toolSignatures: tools
      .map((tool) => {
        const record = asRecord(tool)
        const provider = asString(record.provider_id)
          || asString(record.provider)
          || asString(record.plugin_id)
          || asString(record.name)
        const toolName = asString(record.tool_name) || asString(record.name)

        return `${provider}/${toolName}`
      })
      .filter(signature => signature !== '/')
      .sort(),
  }
}

When(
  'I duplicate the preseeded Agent v2 {string} from the Agent Roster',
  async function (this: DifyWorld, agentName: string) {
    const page = this.getPage()
    const agent = getPreseededAgent(this, agentName)
    const copyName = createE2EResourceName('Agent', 'copy')

    await page.goto('/roster')
    const card = page.locator('article').filter({
      has: page.getByRole('link', { name: agentName }),
    }).first()

    await expect(card).toBeVisible({ timeout: 30_000 })
    await card.hover()
    await card.getByLabel(`More actions for ${agentName}`).click()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()

    const dialog = page.getByRole('dialog', { name: 'Duplicate agent' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: /Name/ }).fill(copyName)

    const copyResponsePromise = page.waitForResponse(response => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith(`/console/api/agent/${agent.id}/copy`)
    ))
    await dialog.getByRole('button', { name: 'Duplicate' }).click()

    const copyResponse = await copyResponsePromise
    expect(copyResponse.status()).toBe(201)
    const copiedAgent = (await copyResponse.json()) as PostAgentByAgentIdCopyResponse
    if (!copiedAgent.id)
      throw new Error('Agent v2 duplicate response did not include a copied Agent ID.')

    this.createdAgentIds.push(copiedAgent.id)
    this.lastCreatedAgentName = copiedAgent.name
    this.lastCreatedAgentRole = copiedAgent.role ?? undefined

    await expect(page.getByText('Agent duplicated.')).toBeVisible()
  },
)

Then('I should see the Agent v2 full-config fixture sections', async function (this: DifyWorld) {
  const page = this.getPage()
  const stableModel = this.agentBuilder.preflight.stableModel
  if (!stableModel)
    throw new Error('Stable chat model preflight must run before asserting the full-config Agent.')

  await expect(page.getByRole('heading', { name: 'Configure' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(agentBuilderPreseededResources.fullConfigAgent, { exact: true }))
    .toBeVisible()
  await expect(page.getByText(stableModel.name, { exact: true })).toBeVisible()

  const promptSection = page.getByRole('region', { name: 'Prompt' })
  await expect(promptSection).toBeVisible()
  await expect(promptSection).toContainText(agentBuilderExpectedTokens.agentReply)

  const skillsSection = page.getByRole('region', { name: 'Skills' })
  await expect(skillsSection).toBeVisible()
  await expect(skillsSection.getByRole('button', {
    exact: true,
    name: agentBuilderPreseededResources.summarySkill,
  })).toBeVisible()

  const filesSection = page.getByRole('region', { name: 'Files' })
  await expect(filesSection).toBeVisible()
  await expect(filesSection.getByRole('button', {
    exact: true,
    name: agentBuilderTestMaterials.smallFile,
  })).toBeVisible()
  await expect(filesSection.getByRole('button', {
    exact: true,
    name: agentBuilderTestMaterials.specialFilename,
  })).toBeVisible()

  const toolsSection = page.getByRole('region', { name: 'Tools' })
  await expect(toolsSection).toBeVisible()
  await expectProviderToolActionVisible(
    toolsSection,
    agentBuilderPreseededResources.jsonReplaceTool,
  )

  const knowledgeSection = page.getByRole('region', { name: 'Knowledge Retrieval' })
  await expect(knowledgeSection).toBeVisible()
  await expect(knowledgeSection.getByText('Retrieval 1', { exact: true })).toBeVisible()

  const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })
  await expect(advancedSettings).toBeVisible()
  await expect(
    advancedSettings.getByText('For power users. Env vars, sandbox & memory.'),
  ).toBeVisible()
})

Then(
  'the duplicated Agent v2 should inherit the full-config fixture from {string}',
  async function (this: DifyWorld, agentName: string) {
    const sourceAgent = getPreseededAgent(this, agentName)
    const duplicatedAgentId = getCurrentAgentId(this)
    const stableModel = this.agentBuilder.preflight.stableModel
    if (!stableModel)
      throw new Error('Stable chat model preflight must run before asserting the duplicated Agent.')

    const [sourceDetail, duplicatedDetail, sourceSnapshot, duplicatedSnapshot] = await Promise.all([
      getTestAgent(sourceAgent.id),
      getTestAgent(duplicatedAgentId),
      getComposerInheritanceSnapshot(sourceAgent.id),
      getComposerInheritanceSnapshot(duplicatedAgentId),
    ])

    expect(duplicatedDetail.id).toBe(duplicatedAgentId)
    expect(duplicatedDetail.name).toBe(this.lastCreatedAgentName)
    expect(duplicatedDetail.active_config_is_published).toBe(sourceDetail.active_config_is_published)
    expect(duplicatedSnapshot.model).toEqual({
      name: stableModel.name,
      provider: stableModel.provider,
    })
    expect(duplicatedSnapshot.model).toEqual(sourceSnapshot.model)
    expect(duplicatedSnapshot.prompt).toBe(sourceSnapshot.prompt)
    expect(duplicatedSnapshot.fileNames).toEqual(expect.arrayContaining([
      agentBuilderTestMaterials.smallFile,
      agentBuilderTestMaterials.specialFilename,
    ]))
    expect(duplicatedSnapshot.toolSignatures).toEqual(sourceSnapshot.toolSignatures)
    expect(duplicatedSnapshot.knowledgeDatasetNames).toEqual(expect.arrayContaining([
      agentBuilderPreseededResources.agentKnowledgeBase,
    ]))
  },
)

Then(
  'the preseeded Agent v2 {string} should still use the normal E2E prompt',
  async function (this: DifyWorld, agentName: string) {
    const sourceAgent = getPreseededAgent(this, agentName)

    await expect.poll(
      async () => {
        const draft = await getAgentComposerDraft(sourceAgent.id)

        return asString(asRecord(draft.agent_soul?.prompt).system_prompt)
      },
      { timeout: 30_000 },
    ).toBe(normalAgentPrompt)
  },
)

Then('I should see the Agent v2 tool state fixture tools', async function (this: DifyWorld) {
  const page = this.getPage()
  const toolsSection = page.getByRole('region', { name: 'Tools' })

  await expect(toolsSection).toBeVisible({ timeout: 30_000 })
  await expect(toolsSection.getByRole('button', { exact: true, name: 'Not authorized' })).toBeVisible()

  const { action: jsonReplaceAction, tool: jsonTool } = await expectProviderToolActionVisible(
    toolsSection,
    agentBuilderPreseededResources.jsonReplaceTool,
  )
  await jsonReplaceAction.hover()
  await expect(toolsSection.getByRole('button', {
    exact: true,
    name: `Edit ${jsonTool.actionName}`,
  })).toBeVisible()
  await expect(toolsSection.getByRole('button', {
    exact: true,
    name: `Remove ${jsonTool.actionName}`,
  })).toBeVisible()

  await expectProviderToolActionVisible(
    toolsSection,
    agentBuilderPreseededResources.tavilySearchTool,
  )
})

async function skipToolCredentialErrorState(world: DifyWorld) {
  return skipBlockedPrecondition(
    world,
    'Agent v2 Tool credential error state is not covered: the current fixture only proves usable and not-authorized tool states.',
    {
      owner: 'seed/product',
      remediation: 'Define a stable invalid credential fixture and the expected user-visible error label before enabling this scenario.',
    },
  )
}

Given('Agent v2 Tool credential error state is available', async function (this: DifyWorld) {
  return skipToolCredentialErrorState(this)
})

Then('Agent v2 Tool credential error state should be available', async function (this: DifyWorld) {
  return skipToolCredentialErrorState(this)
})

Then('I should see the Agent v2 dual retrieval fixture settings', async function (this: DifyWorld) {
  const page = this.getPage()
  const knowledgeSection = page.getByRole('region', { name: 'Knowledge Retrieval' })

  await expect(knowledgeSection).toBeVisible({ timeout: 30_000 })
  await expect(knowledgeSection.getByText('Retrieval 1', { exact: true })).toBeVisible()
  await expect(knowledgeSection.getByText('Retrieval 2', { exact: true })).toBeVisible()

  const agentDecideDialog = await openAgentKnowledgeRetrievalDialog(knowledgeSection, 'Retrieval 1')
  await expect(agentDecideDialog.getByText(agentBuilderPreseededResources.agentKnowledgeBase, {
    exact: true,
  })).toBeVisible()
  await expect(agentDecideDialog.getByRole('radio', {
    exact: true,
    name: 'Agent decide',
  })).toBeChecked()
  await agentDecideDialog.getByRole('button', { name: 'Close' }).click()
  await expect(agentDecideDialog).not.toBeVisible()

  const customQueryDialog = await openAgentKnowledgeRetrievalDialog(knowledgeSection, 'Retrieval 2')
  await expect(customQueryDialog.getByText(agentBuilderPreseededResources.agentKnowledgeBase, {
    exact: true,
  })).toBeVisible()
  await expect(customQueryDialog.getByRole('radio', {
    exact: true,
    name: 'Custom query',
  })).toBeChecked()
  await expect(customQueryDialog.getByRole('textbox', {
    exact: true,
    name: 'Custom query text',
  })).toHaveValue(agentBuilderFixedInputs.customKnowledgeQuery)
})
