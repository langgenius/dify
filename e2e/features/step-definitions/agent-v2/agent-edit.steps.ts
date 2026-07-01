import type { DifyWorld } from '../../support/world'
import { Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { agentBuilderExpectedTokens, agentBuilderFixedInputs, agentBuilderPreseededResources } from '../../../support/agent-builder-resources'
import { agentBuilderTestMaterials } from '../../../support/test-materials'
import { expectProviderToolActionVisible, openAgentKnowledgeRetrievalDialog } from './configure-helpers'

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
