import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import {
  createAgentSoulConfigWithModel,
  createConfiguredTestAgent,
  createTestAgent,
  getAgentComposerDraft,
  getAgentConfigurePath,
  getTestAgent,
  normalAgentPrompt,
  normalAgentSoulConfig,
  saveAgentBuildDraft,
  saveAgentComposerDraft,
  updatedAgentPrompt,
  updatedAgentSoulConfig,
} from '../../../support/agent'
import { agentBuilderFixedInputs } from '../../../support/agent-builder-resources'
import { waitForAgentConfigureAutosaved } from '../../../support/agent-configure'
import { agentBuilderTestMaterials, getAgentBuilderTestMaterialPath } from '../../../support/test-materials'

const getCurrentAgentId = (world: DifyWorld) => {
  const agentId = world.createdAgentIds.at(-1)
  if (!agentId)
    throw new Error('No Agent v2 ID found. Create an Agent v2 test agent first.')

  return agentId
}

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
  if (!this.agentBuilderStableChatModel)
    throw new Error('Create a runnable Agent v2 test agent after stable model preflight.')

  const agent = await createConfiguredTestAgent({
    agentSoul: createAgentSoulConfigWithModel(
      normalAgentSoulConfig,
      this.agentBuilderStableChatModel,
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

Given('an Agent v2 Build draft uses the updated E2E prompt', async function (this: DifyWorld) {
  await saveAgentBuildDraft(getCurrentAgentId(this), updatedAgentSoulConfig)
})

When('I open the Agent v2 configure page', async function (this: DifyWorld) {
  await this.getPage().goto(getAgentConfigurePath(getCurrentAgentId(this)))
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

When('I discard the Agent v2 Build draft', async function (this: DifyWorld) {
  await this.getPage().getByRole('button', { name: 'Discard' }).click()
})

When('I publish the Agent v2 draft', async function (this: DifyWorld) {
  const page = this.getPage()
  const publishButton = page.getByRole('button', { name: /^Publish(?: update)?$/ })

  await expect(publishButton).toBeEnabled({ timeout: 30_000 })
  await publishButton.click()
})

When('I upload the small Agent v2 file from the Files section', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentId = getCurrentAgentId(this)
  const fileName = agentBuilderTestMaterials.smallFile
  const filePath = getAgentBuilderTestMaterialPath('smallFile')

  await page.getByRole('button', { name: 'Add file' }).click()
  const dialog = page.getByRole('dialog', { name: 'Upload file' })
  await expect(dialog).toBeVisible()

  const fileChooserPromise = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'browse' }).click()
  await (await fileChooserPromise).setFiles(filePath)
  await expect(dialog.getByText(fileName)).toBeVisible()

  const commitResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith(`/console/api/agent/${agentId}/config/files`)
  ))
  await dialog.getByRole('button', { name: 'Upload' }).click()
  const commitResponse = await commitResponsePromise
  expect(commitResponse.status()).toBe(201)
  const committed = await commitResponse.json() as { file?: { name?: string } }
  await expect(dialog).not.toBeVisible({ timeout: 30_000 })

  const committedName = committed.file?.name
  if (!committedName)
    throw new Error('Agent config file upload response did not include a file name.')

  this.createdAgentConfigFiles.push({ agentId, name: committedName })
})

When(
  'I add the plain Agent v2 environment variable from Advanced Settings',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })

    await page.getByRole('button', { name: 'Advanced Settings' }).first().click()
    await expect(advancedSettings.getByRole('heading', { name: 'Env Editor' })).toBeVisible()

    await advancedSettings
      .getByRole('textbox', { name: 'Key' })
      .fill(agentBuilderFixedInputs.envPlainKey)
    await advancedSettings
      .getByRole('textbox', { name: 'Value' })
      .fill(agentBuilderFixedInputs.envPlainValue)
    await expect(advancedSettings.getByText('Plain', { exact: true })).toBeVisible()
  },
)

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

Then('I should see the small Agent v2 file in the Files section', async function (this: DifyWorld) {
  const fileName = agentBuilderTestMaterials.smallFile
  await expect(
    this.getPage().getByRole('button', { exact: true, name: fileName }),
  ).toBeVisible({ timeout: 30_000 })
})

Then(
  'the small Agent v2 file should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)
    const fileName = agentBuilderTestMaterials.smallFile

    await expect
      .poll(async () => (
        await getAgentComposerDraft(agentId)
      ).agent_soul?.config_files?.map(file => file.name) ?? [], {
        timeout: 30_000,
      })
      .toContain(fileName)
  },
)

Then(
  'the plain Agent v2 environment variable should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)

    await expect
      .poll(async () => {
        const env = (await getAgentComposerDraft(agentId)).agent_soul?.env
        const variable = env?.variables?.find((item) => {
          const key = item.key ?? item.name ?? item.variable

          return key === agentBuilderFixedInputs.envPlainKey
        })

        return {
          secretCount: env?.secret_refs?.length ?? 0,
          value: variable?.value,
        }
      }, {
        timeout: 30_000,
      })
      .toEqual({
        secretCount: 0,
        value: agentBuilderFixedInputs.envPlainValue,
      })
  },
)

Then(
  'I should see the plain Agent v2 environment variable in Advanced Settings',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })

    await page.getByRole('button', { name: 'Advanced Settings' }).first().click()
    await expect(advancedSettings.getByRole('heading', { name: 'Env Editor' })).toBeVisible()
    await expect(advancedSettings.getByRole('textbox', { name: 'Key' }))
      .toHaveValue(agentBuilderFixedInputs.envPlainKey)
    await expect(advancedSettings.getByRole('textbox', { name: 'Value' }))
      .toHaveValue(agentBuilderFixedInputs.envPlainValue)
    await expect(advancedSettings.getByText('Plain', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Preview$/i })).toBeVisible()
  },
)

Then('I should see the Agent v2 Build draft pending changes', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByText('Build draft')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible()
})

Then('the Agent v2 Build draft should no longer be active', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByText('Build draft')).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Discard' })).not.toBeVisible()
})

Then('the Agent v2 configuration should be saved automatically', async function (this: DifyWorld) {
  await waitForAgentConfigureAutosaved(this.getPage())
})

Then('the Agent v2 draft should be published and up to date', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentId = getCurrentAgentId(this)

  await expect(page.getByRole('button', { name: 'Published' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Up to date')).toBeVisible()
  await expect.poll(async () => (await getTestAgent(agentId)).active_config_is_published).toBe(true)
})
