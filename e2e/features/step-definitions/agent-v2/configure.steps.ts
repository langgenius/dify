import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import {
  createAgentSoulConfigWithModel,
  createConfiguredTestAgent,
  createTestAgent,
  getAgentComposerDraft,
  getAgentConfigurePath,
  getAgentDriveSkills,
  normalAgentPrompt,
  normalAgentSoulConfig,
  saveAgentComposerDraft,
  updatedAgentPrompt,
  uploadAgentDriveSkill,
} from '../../agent-v2/support/agent'
import { agentBuilderTestMaterials, getAgentBuilderTestMaterialPath } from '../../agent-v2/support/test-materials'
import {
  expectNormalAgentPromptDraft,
  getCurrentAgentId,
  getPreseededAgent,
} from './configure-helpers'

Given('an Agent v2 test agent has been created via API', async function (this: DifyWorld) {
  const agent = await createTestAgent()
  this.createdAgentIds.push(agent.id)
  this.lastCreatedAgentName = agent.name
  this.lastCreatedAgentRole = agent.role
})

Given(
  'a basic configured Agent v2 test agent has been created via API',
  async function (this: DifyWorld) {
    const agent = await createConfiguredTestAgent()
    this.createdAgentIds.push(agent.id)
    this.lastCreatedAgentName = agent.name
    this.lastCreatedAgentRole = agent.role
  },
)

Given('a runnable Agent v2 test agent has been created via API', async function (this: DifyWorld) {
  if (!this.agentBuilder.preflight.stableModel)
    throw new Error('Create a runnable Agent v2 test agent after stable model preflight.')

  const agent = await createConfiguredTestAgent({
    agentSoul: createAgentSoulConfigWithModel(
      normalAgentSoulConfig,
      this.agentBuilder.preflight.stableModel,
    ),
  })
  this.createdAgentIds.push(agent.id)
  this.lastCreatedAgentName = agent.name
  this.lastCreatedAgentRole = agent.role
})

Given('a minimal Agent v2 composer draft has been synced', async function (this: DifyWorld) {
  const agentId = getCurrentAgentId(this)

  await saveAgentComposerDraft(agentId)
})

Given('the Agent v2 composer draft uses the normal E2E prompt', async function (this: DifyWorld) {
  await saveAgentComposerDraft(getCurrentAgentId(this), normalAgentSoulConfig)
})

Given('the e2e-summary-skill Skill is available to the Agent v2 test agent', async function (this: DifyWorld) {
  await uploadAgentDriveSkill({
    agentId: getCurrentAgentId(this),
    fileName: agentBuilderTestMaterials.summarySkill,
    filePath: getAgentBuilderTestMaterialPath('summarySkill'),
  })
})

Then('the Agent v2 test agent should include drive skill {string}', async function (this: DifyWorld, skillName: string) {
  const skills = await getAgentDriveSkills(getCurrentAgentId(this))

  expect(skills.map(skill => skill.name)).toContain(skillName)
})

When('I open the Agent v2 configure page', async function (this: DifyWorld) {
  await this.getPage().goto(getAgentConfigurePath(getCurrentAgentId(this)))
})

When('I switch to the Agent v2 Configure section', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentId = getCurrentAgentId(this)

  await page.getByRole('link', { name: 'Configure' }).click()
  await expect(page).toHaveURL(new RegExp(`/roster/agent/${agentId}/configure(?:\\?.*)?$`))
  await expect(page.getByRole('heading', { name: 'Configure' })).toBeVisible({ timeout: 30_000 })
})

When('I open the Agent v2 configure page from the Agent Roster', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentId = getCurrentAgentId(this)
  const agentName = this.lastCreatedAgentName
  if (!agentName)
    throw new Error('No Agent v2 name found. Create an Agent v2 test agent first.')

  await page.goto('/roster')
  await page.getByRole('link', { name: agentName }).click()
  await expect(page).toHaveURL(new RegExp(`/roster/agent/${agentId}/configure(?:\\?.*)?$`))
  await expect(page.getByRole('heading', { name: 'Configure' })).toBeVisible({ timeout: 30_000 })
})

When(
  'I open the preseeded Agent v2 configure page for {string} from the Agent Roster',
  async function (this: DifyWorld, agentName: string) {
    const page = this.getPage()
    const agent = getPreseededAgent(this, agentName)

    await page.goto('/roster')
    await page.getByRole('link', { name: agentName }).click()
    await expect(page).toHaveURL(new RegExp(`/roster/agent/${agent.id}/configure(?:\\?.*)?$`))
    await expect(page.getByRole('heading', { name: 'Configure' })).toBeVisible({ timeout: 30_000 })
  },
)

When('I fill the Agent v2 prompt editor with the normal E2E prompt', async function (this: DifyWorld) {
  const page = this.getPage()
  const promptSection = page.getByRole('region', { name: 'Prompt' })

  await expect(promptSection).toBeVisible({ timeout: 30_000 })
  await promptSection.getByRole('textbox', { name: 'Prompt' }).fill(normalAgentPrompt)
})

When('I fill the Agent v2 prompt editor with the updated E2E prompt', async function (this: DifyWorld) {
  const page = this.getPage()
  const promptSection = page.getByRole('region', { name: 'Prompt' })

  await expect(promptSection).toBeVisible({ timeout: 30_000 })
  await promptSection.getByRole('textbox', { name: 'Prompt' }).fill(updatedAgentPrompt)
})

Then('I should be on the Agent v2 configure page', async function (this: DifyWorld) {
  const agentId = getCurrentAgentId(this)

  await expect(this.getPage()).toHaveURL(
    new RegExp(`/roster/agent/${agentId}/configure(?:\\?.*)?$`),
  )
})

Then('I should see the Agent v2 configure workspace', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByRole('region', { name: 'Configure' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Configure' })).toBeVisible()
  await expect(page.getByText(this.lastCreatedAgentName!)).toBeVisible()
})

Then(
  'I should see the normal E2E prompt in the Agent v2 prompt editor',
  async function (this: DifyWorld) {
    const page = this.getPage()

    await expect(page.getByRole('heading', { name: 'Prompt' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(normalAgentPrompt)).toBeVisible()
  },
)

Then(
  'I should see the stable E2E model in the Agent v2 model selector',
  async function (this: DifyWorld) {
    const stableModel = this.agentBuilder.preflight.stableModel
    if (!stableModel)
      throw new Error('Stable chat model preflight must run before asserting the Agent model.')

    await expect(this.getPage().getByText(stableModel.name, { exact: true }))
      .toBeVisible({ timeout: 30_000 })
  },
)

Then(
  'I should see the updated E2E prompt in the Agent v2 prompt editor',
  async function (this: DifyWorld) {
    const page = this.getPage()

    await expect(page.getByRole('heading', { name: 'Prompt' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(updatedAgentPrompt)).toBeVisible()
  },
)

Then(
  'Agent v2 Preview should be unavailable until a model is configured',
  async function (this: DifyWorld) {
    const page = this.getPage()

    await expect(page.getByRole('heading', { name: 'Configure' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /^Preview$/i })).toBeDisabled()
  },
)

Then(
  'the normal Agent v2 draft should still use the normal E2E prompt',
  async function (this: DifyWorld) {
    await expectNormalAgentPromptDraft(this)
  },
)

Then(
  'the normal Agent v2 draft should use the normal E2E prompt',
  async function (this: DifyWorld) {
    await expectNormalAgentPromptDraft(this)
  },
)

Then(
  'the normal Agent v2 draft should use the updated E2E prompt',
  async function (this: DifyWorld) {
    await expect.poll(
      async () => (await getAgentComposerDraft(getCurrentAgentId(this))).agent_soul?.prompt,
      { timeout: 30_000 },
    ).toEqual({ system_prompt: updatedAgentPrompt })
  },
)

Then(
  'the Agent v2 draft should use the stable E2E model',
  async function (this: DifyWorld) {
    const stableModel = this.agentBuilder.preflight.stableModel
    if (!stableModel)
      throw new Error('Stable chat model preflight must run before asserting the Agent model.')

    await expect.poll(
      async () => {
        const model = (await getAgentComposerDraft(getCurrentAgentId(this))).agent_soul?.model
        const modelConfig = typeof model === 'object' && model !== null && !Array.isArray(model)
          ? model as Record<string, unknown>
          : undefined

        return {
          model: modelConfig?.model,
          provider: modelConfig?.model_provider,
        }
      },
      { timeout: 30_000 },
    ).toEqual({
      model: stableModel.name,
      provider: stableModel.provider,
    })
  },
)
