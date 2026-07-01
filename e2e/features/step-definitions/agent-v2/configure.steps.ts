import type { Page } from '@playwright/test'
import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { waitForAgentConfigureAutosaved } from '../../../support/agent-configure'
import {
  concurrentFirstAgentPrompt,
  concurrentSecondAgentPrompt,
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

const concurrentAgentPrompts = [
  concurrentFirstAgentPrompt,
  concurrentSecondAgentPrompt,
]

function attachPageDiagnostics(world: DifyWorld, page: Page) {
  page.setDefaultTimeout(30_000)
  page.on('console', (message) => {
    if (message.type() === 'error')
      world.consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => {
    world.pageErrors.push(error.message)
  })
  page.on('download', (dl) => {
    world.capturedDownloads.push(dl)
  })
}

const getPromptEditor = (page: Page) =>
  page.getByRole('region', { name: 'Prompt' }).getByRole('textbox', { name: 'Prompt' })

async function fillAgentPromptEditor(page: Page, prompt: string) {
  const promptSection = page.getByRole('region', { name: 'Prompt' })

  await expect(promptSection).toBeVisible({ timeout: 30_000 })
  await getPromptEditor(page).fill(prompt)
}

async function selectAgentModel(page: Page, modelName: string) {
  await page.getByRole('combobox', { name: 'Configure model' }).click()
  await page.getByLabel('Search model').fill(modelName)
  await page.getByRole('option', { name: modelName }).click()
}

async function expectAgentComposerPrompt(agentId: string, prompt: string) {
  await expect.poll(
    async () => (await getAgentComposerDraft(agentId)).agent_soul?.prompt?.system_prompt,
    { timeout: 30_000 },
  ).toBe(prompt)
}

Given('an Agent v2 test agent has been created via API', async function (this: DifyWorld) {
  const agent = await createTestAgent()
  this.createdAgentIds.push(agent.id)
  this.lastCreatedAgentName = agent.name
  this.lastCreatedAgentRole = agent.role ?? undefined
})

Given(
  'a basic configured Agent v2 test agent has been created via API',
  async function (this: DifyWorld) {
    const agent = await createConfiguredTestAgent()
    this.createdAgentIds.push(agent.id)
    this.lastCreatedAgentName = agent.name
    this.lastCreatedAgentRole = agent.role ?? undefined
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
  this.lastCreatedAgentRole = agent.role ?? undefined
})

Given('a minimal Agent v2 composer draft has been synced', async function (this: DifyWorld) {
  const agentId = getCurrentAgentId(this)

  await saveAgentComposerDraft(agentId)
})

Given('the Agent v2 composer draft uses the normal E2E prompt', async function (this: DifyWorld) {
  await saveAgentComposerDraft(getCurrentAgentId(this), normalAgentSoulConfig)
})

Given('the e2e-summary-skill Skill is available to the Agent v2 test agent', async function (this: DifyWorld) {
  const agentId = getCurrentAgentId(this)
  const upload = await uploadAgentDriveSkill({
    agentId,
    fileName: agentBuilderTestMaterials.summarySkill,
    filePath: getAgentBuilderTestMaterialPath('summarySkill'),
  })
  this.createdAgentDriveFiles.push({ agentId, key: upload.skill.skill_md_key })
  if (upload.skill.archive_key)
    this.createdAgentDriveFiles.push({ agentId, key: upload.skill.archive_key })
})

Then('the Agent v2 test agent should include drive skill {string}', async function (this: DifyWorld, skillName: string) {
  const skills = await getAgentDriveSkills(getCurrentAgentId(this))

  expect(skills.map(skill => skill.name)).toContain(skillName)
})

When('I open the Agent v2 configure page', async function (this: DifyWorld) {
  await this.getPage().goto(getAgentConfigurePath(getCurrentAgentId(this)))
})

When(
  'I select the stable E2E model in the Agent v2 model selector',
  async function (this: DifyWorld) {
    const stableModel = this.agentBuilder.preflight.stableModel
    if (!stableModel)
      throw new Error('Stable chat model preflight must run before selecting the Agent model.')

    await selectAgentModel(this.getPage(), stableModel.name)
  },
)

When('I switch to the Agent v2 Configure section', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentId = getCurrentAgentId(this)

  await page.getByRole('link', { name: 'Configure' }).click()
  await expect(page).toHaveURL(new RegExp(`/roster/agent/${agentId}/configure(?:\\?.*)?$`))
  await expect(page.getByRole('heading', { name: 'Configure' })).toBeVisible({ timeout: 30_000 })
})

When('I leave the Agent v2 configure page before autosave completes', async function (this: DifyWorld) {
  const page = this.getPage()

  await page.goto('/roster')
  await expect(page).toHaveURL(/\/roster(?:\?.*)?$/)
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
  await fillAgentPromptEditor(this.getPage(), normalAgentPrompt)
})

When('I fill the Agent v2 prompt editor with the updated E2E prompt', async function (this: DifyWorld) {
  await fillAgentPromptEditor(this.getPage(), updatedAgentPrompt)
})

When('I open the same Agent v2 configure page in another tab', async function (this: DifyWorld) {
  if (!this.context)
    throw new Error('Playwright context has not been initialized for this scenario.')

  const agentId = getCurrentAgentId(this)
  const concurrentPage = await this.context.newPage()
  attachPageDiagnostics(this, concurrentPage)
  this.agentBuilder.configure.concurrentPage = concurrentPage

  await concurrentPage.goto(getAgentConfigurePath(agentId))
  await expect(concurrentPage).toHaveURL(new RegExp(`/roster/agent/${agentId}/configure(?:\\?.*)?$`))
  await expect(concurrentPage.getByRole('heading', { name: 'Configure' })).toBeVisible({ timeout: 30_000 })
})

When('I save the Agent v2 prompt from the first configure tab', async function (this: DifyWorld) {
  const agentId = getCurrentAgentId(this)

  await fillAgentPromptEditor(this.getPage(), concurrentFirstAgentPrompt)
  await waitForAgentConfigureAutosaved(this.getPage())
  await expectAgentComposerPrompt(agentId, concurrentFirstAgentPrompt)
})

When('I save the Agent v2 prompt from the second configure tab', async function (this: DifyWorld) {
  const agentId = getCurrentAgentId(this)
  const concurrentPage = this.agentBuilder.configure.concurrentPage
  if (!concurrentPage)
    throw new Error('Open the same Agent v2 configure page in another tab before editing it.')

  await fillAgentPromptEditor(concurrentPage, concurrentSecondAgentPrompt)
  await waitForAgentConfigureAutosaved(concurrentPage)
  await expectAgentComposerPrompt(agentId, concurrentSecondAgentPrompt)
})

When('I refresh both Agent v2 configure tabs', async function (this: DifyWorld) {
  const page = this.getPage()
  const concurrentPage = this.agentBuilder.configure.concurrentPage
  if (!concurrentPage)
    throw new Error('Open the same Agent v2 configure page in another tab before refreshing it.')

  await Promise.all([
    page.reload(),
    concurrentPage.reload(),
  ])
  await expect(page.getByRole('heading', { name: 'Configure' })).toBeVisible({ timeout: 30_000 })
  await expect(concurrentPage.getByRole('heading', { name: 'Configure' })).toBeVisible({ timeout: 30_000 })
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

    await expect(getPromptEditor(page)).toContainText(normalAgentPrompt, { timeout: 30_000 })
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

    await expect(getPromptEditor(page)).toContainText(updatedAgentPrompt, { timeout: 30_000 })
  },
)

Then(
  'both Agent v2 configure tabs and the Agent v2 draft should show one saved concurrent prompt',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)
    const concurrentPage = this.agentBuilder.configure.concurrentPage
    if (!concurrentPage)
      throw new Error('Open the same Agent v2 configure page in another tab before asserting convergence.')

    let savedPrompt = ''
    await expect.poll(
      async () => {
        const prompt = (await getAgentComposerDraft(agentId)).agent_soul?.prompt?.system_prompt
        if (prompt && concurrentAgentPrompts.includes(prompt))
          savedPrompt = prompt

        return !!savedPrompt
      },
      { timeout: 30_000 },
    ).toBe(true)

    await expect(getPromptEditor(this.getPage())).toContainText(savedPrompt)
    await expect(getPromptEditor(concurrentPage)).toContainText(savedPrompt)
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
