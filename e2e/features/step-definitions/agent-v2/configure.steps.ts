import type { Locator } from '@playwright/test'
import type { AgentComposerEnvVariable } from '../../../support/agent'
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
import {
  agentBuilderExpectedTokens,
  agentBuilderFixedInputs,
  agentBuilderPreseededResources,
} from '../../../support/agent-builder-resources'
import { waitForAgentConfigureAutosaved } from '../../../support/agent-configure'
import {
  agentBuilderTestMaterials,
  getAgentBuilderTestMaterialPath,
} from '../../../support/test-materials'

const getCurrentAgentId = (world: DifyWorld) => {
  const agentId = world.createdAgentIds.at(-1)
  if (!agentId)
    throw new Error('No Agent v2 ID found. Create an Agent v2 test agent first.')

  return agentId
}

const getPreseededAgent = (world: DifyWorld, name: string) => {
  const resource = world.agentBuilderPreseededResources[name]
  if (!resource || resource.kind !== 'agent') {
    throw new Error(
      `Preseeded Agent "${name}" is not available. Run the matching preflight step first.`,
    )
  }

  return resource
}

const getPreseededToolDisplayParts = (displayName: string) => {
  const [providerName, actionName] = displayName.split(' / ')
  if (!providerName || !actionName)
    throw new Error(`Preseeded tool display name must use "Provider / Action": ${displayName}`)

  return { actionName, providerName }
}

const getEnvVariableKey = (variable: AgentComposerEnvVariable) =>
  variable.key ?? variable.name ?? variable.variable

const getAgentEnvVariableValue = (
  variables: AgentComposerEnvVariable[],
  key: string,
) => variables.find(variable => getEnvVariableKey(variable) === key)?.value

const getAgentEnvVariables = async (agentId: string) =>
  (await getAgentComposerDraft(agentId)).agent_soul?.env?.variables ?? []

const uploadAgentConfigFile = async (
  world: DifyWorld,
  material: keyof typeof agentBuilderTestMaterials,
) => {
  const page = world.getPage()
  const agentId = getCurrentAgentId(world)
  const fileName = agentBuilderTestMaterials[material]
  const filePath = getAgentBuilderTestMaterialPath(material)

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

  world.createdAgentConfigFiles.push({ agentId, name: committedName })
}

const expectAgentConfigFileVisible = async (
  world: DifyWorld,
  material: keyof typeof agentBuilderTestMaterials,
) => {
  await expect(
    world.getPage().getByRole('button', {
      exact: true,
      name: agentBuilderTestMaterials[material],
    }),
  ).toBeVisible({ timeout: 30_000 })
}

const expectAgentConfigFileSaved = async (
  world: DifyWorld,
  material: keyof typeof agentBuilderTestMaterials,
) => {
  const agentId = getCurrentAgentId(world)
  const fileName = agentBuilderTestMaterials[material]

  await expect
    .poll(async () => (
      await getAgentComposerDraft(agentId)
    ).agent_soul?.config_files?.map(file => file.name) ?? [], {
      timeout: 30_000,
    })
    .toContain(fileName)
}

const expectNormalAgentPromptDraft = async (world: DifyWorld) => {
  await expect.poll(
    async () => (await getAgentComposerDraft(getCurrentAgentId(world))).agent_soul?.prompt,
    { timeout: 30_000 },
  ).toEqual({ system_prompt: normalAgentPrompt })
}

const expectProviderToolActionVisible = async (
  toolsSection: Locator,
  displayName: string,
) => {
  const tool = getPreseededToolDisplayParts(displayName)
  const provider = toolsSection.getByRole('button', {
    exact: true,
    name: tool.providerName,
  })
  await expect(provider).toBeVisible()

  const action = toolsSection.getByText(tool.actionName, { exact: true })
  if (!await action.isVisible())
    await provider.click()
  await expect(action).toBeVisible()

  return { action, tool }
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

Given(
  'an Agent v2 Build draft uses the updated E2E prompt with the stable E2E model',
  async function (this: DifyWorld) {
    if (!this.agentBuilderStableChatModel)
      throw new Error('Create an Agent v2 Build draft with a stable model after stable model preflight.')

    await saveAgentBuildDraft(
      getCurrentAgentId(this),
      createAgentSoulConfigWithModel(updatedAgentSoulConfig, this.agentBuilderStableChatModel),
    )
  },
)

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

When('I discard the Agent v2 Build draft', async function (this: DifyWorld) {
  await this.getPage().getByRole('button', { name: 'Discard' }).click()
})

When('I apply the Agent v2 Build draft', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentId = getCurrentAgentId(this)
  const applyButton = page.getByRole('button', { name: 'Apply' })

  await expect(applyButton).toBeEnabled({ timeout: 30_000 })
  const finalizeResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith(`/console/api/agent/${agentId}/build-chat/finalize`)
  ), { timeout: 120_000 })
  const applyResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith(`/console/api/agent/${agentId}/build-draft/apply`)
  ), { timeout: 120_000 })

  await applyButton.click()
  expect((await finalizeResponsePromise).ok()).toBe(true)
  expect((await applyResponsePromise).ok()).toBe(true)
  await expect(page.getByText('Action succeeded')).toBeVisible()
})

When('I publish the Agent v2 draft', async function (this: DifyWorld) {
  const page = this.getPage()
  const publishButton = page.getByRole('button', { name: /^Publish(?: update)?$/ })

  await expect(publishButton).toBeEnabled({ timeout: 30_000 })
  await publishButton.click()
})

When('I upload the small Agent v2 file from the Files section', async function (this: DifyWorld) {
  await uploadAgentConfigFile(this, 'smallFile')
})

When('I upload the special-name Agent v2 file from the Files section', async function (this: DifyWorld) {
  await uploadAgentConfigFile(this, 'specialFilename')
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

When(
  'I import the invalid Agent v2 environment file from Advanced Settings',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })

    const fileChooserPromise = page.waitForEvent('filechooser')
    await advancedSettings.getByRole('button', { name: 'Import .env' }).click()
    await (await fileChooserPromise).setFiles(getAgentBuilderTestMaterialPath('invalidEnv'))
  },
)

When(
  'I add the secondary plain Agent v2 environment variable from Advanced Settings',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })

    await advancedSettings.getByRole('button', { name: 'Add environment variable' }).click()
    await advancedSettings
      .getByRole('textbox', { name: 'Key' })
      .last()
      .fill(agentBuilderFixedInputs.envModeKey)
    await advancedSettings
      .getByRole('textbox', { name: 'Value' })
      .last()
      .fill(agentBuilderFixedInputs.envModeValue)
    await expect(advancedSettings.getByText('Plain', { exact: true })).toHaveCount(2)
  },
)

When(
  'I delete the plain Agent v2 environment variable from Advanced Settings',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })

    await advancedSettings
      .getByRole('button', { name: `Delete ${agentBuilderFixedInputs.envPlainKey}` })
      .click()
  },
)

When(
  'I import the valid Agent v2 environment file from Advanced Settings',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })

    await page.getByRole('button', { name: 'Advanced Settings' }).first().click()
    await expect(advancedSettings.getByRole('heading', { name: 'Env Editor' })).toBeVisible()

    const fileChooserPromise = page.waitForEvent('filechooser')
    await advancedSettings.getByRole('button', { name: 'Import .env' }).click()
    await (await fileChooserPromise).setFiles(getAgentBuilderTestMaterialPath('validEnv'))
  },
)

When('I expand Agent v2 Advanced Settings', async function (this: DifyWorld) {
  const page = this.getPage()
  const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })

  await page.getByRole('button', { name: 'Advanced Settings' }).first().click()
  await expect(advancedSettings.getByRole('heading', { name: 'Env Editor' })).toBeVisible()
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

Then('I should see the Agent v2 full-config fixture sections', async function (this: DifyWorld) {
  const page = this.getPage()
  const stableModel = this.agentBuilderStableChatModel
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
  await expectAgentConfigFileVisible(this, 'smallFile')
})

Then('I should see the special-name Agent v2 file in the Files section', async function (this: DifyWorld) {
  await expectAgentConfigFileVisible(this, 'specialFilename')
})

Then(
  'the small Agent v2 file should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    await expectAgentConfigFileSaved(this, 'smallFile')
  },
)

Then(
  'the special-name Agent v2 file should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    await expectAgentConfigFileSaved(this, 'specialFilename')
  },
)

Then(
  'Agent v2 Advanced Settings should describe supported entries while collapsed',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })

    await expect(advancedSettings).toBeVisible()
    await expect(
      advancedSettings.getByText('For power users. Env vars, sandbox & memory.'),
    ).toBeVisible()
    await expect(advancedSettings.getByRole('heading', { name: 'Env Editor' }))
      .not
      .toBeVisible()
  },
)

Then(
  'the plain Agent v2 environment variable should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)

    await expect
      .poll(async () => {
        const env = (await getAgentComposerDraft(agentId)).agent_soul?.env
        const variable = env?.variables?.find(item =>
          getEnvVariableKey(item) === agentBuilderFixedInputs.envPlainKey,
        )

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
  'the Agent v2 environment variables for deletion should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)

    await expect
      .poll(async () => {
        const variables = await getAgentEnvVariables(agentId)

        return {
          modeValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envModeKey),
          plainValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envPlainKey),
        }
      }, {
        timeout: 30_000,
      })
      .toEqual({
        modeValue: agentBuilderFixedInputs.envModeValue,
        plainValue: agentBuilderFixedInputs.envPlainValue,
      })
  },
)

Then(
  'the plain Agent v2 environment variable should be removed from the Agent v2 draft',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)

    await expect
      .poll(async () => {
        const variables = await getAgentEnvVariables(agentId)

        return {
          modeValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envModeKey),
          plainValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envPlainKey),
        }
      }, {
        timeout: 30_000,
      })
      .toEqual({
        modeValue: agentBuilderFixedInputs.envModeValue,
        plainValue: undefined,
      })
  },
)

Then(
  'the valid Agent v2 environment import should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)

    await expect
      .poll(async () => {
        const variables = await getAgentEnvVariables(agentId)

        return {
          modeValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envModeKey),
          plainValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envPlainKey),
        }
      }, {
        timeout: 30_000,
      })
      .toEqual({
        modeValue: agentBuilderFixedInputs.envModeValue,
        plainValue: agentBuilderFixedInputs.envPlainValue,
      })
  },
)

Then(
  'the invalid Agent v2 environment import should report skipped lines',
  async function (this: DifyWorld) {
    await expect(this.getPage().getByText('2 invalid .env lines were skipped.')).toBeVisible()
  },
)

Then(
  'the Agent v2 environment variables from the invalid import should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)

    await expect
      .poll(async () => {
        const variables = await getAgentEnvVariables(agentId)

        return {
          importedValue: getAgentEnvVariableValue(
            variables,
            agentBuilderFixedInputs.envAfterInvalidImportKey,
          ),
          plainValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envPlainKey),
        }
      }, {
        timeout: 30_000,
      })
      .toEqual({
        importedValue: agentBuilderFixedInputs.envAfterInvalidImportValue,
        plainValue: agentBuilderFixedInputs.envPlainValue,
      })
  },
)

Then(
  'I should see the supported Agent v2 Advanced Settings entries',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })
    const envEditor = advancedSettings.getByRole('region', { name: 'Env Editor' })

    await expect(envEditor).toBeVisible()
    await expect(envEditor.getByRole('button', { name: 'Import .env' })).toBeVisible()
    await expect(envEditor.getByRole('button', { name: 'Add environment variable' }))
      .toBeVisible()
    await expect(envEditor.getByText('Key', { exact: true })).toBeVisible()
    await expect(envEditor.getByText('Value', { exact: true })).toBeVisible()
    await expect(envEditor.getByText('Scope', { exact: true })).toBeVisible()
  },
)

Then(
  'I should see the Agent v2 environment variables from the valid import in Advanced Settings',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })

    await page.getByRole('button', { name: 'Advanced Settings' }).first().click()
    await expect(advancedSettings.getByRole('heading', { name: 'Env Editor' })).toBeVisible()
    await expect.poll(
      async () => advancedSettings.getByRole('textbox').evaluateAll(inputs =>
        inputs.map(input => (input as HTMLInputElement).value),
      ),
      { timeout: 30_000 },
    ).toEqual(expect.arrayContaining([
      agentBuilderFixedInputs.envPlainKey,
      agentBuilderFixedInputs.envPlainValue,
      agentBuilderFixedInputs.envModeKey,
      agentBuilderFixedInputs.envModeValue,
    ]))
    await expect(advancedSettings.getByText('Plain', { exact: true })).toHaveCount(2)
  },
)

Then(
  'I should not see the deleted Agent v2 environment variable in Advanced Settings',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })

    await page.getByRole('button', { name: 'Advanced Settings' }).first().click()
    await expect(advancedSettings.getByRole('heading', { name: 'Env Editor' })).toBeVisible()
    await expect.poll(
      async () => advancedSettings.getByRole('textbox').evaluateAll(inputs =>
        inputs.map(input => (input as HTMLInputElement).value),
      ),
      { timeout: 30_000 },
    ).toEqual(expect.arrayContaining([
      agentBuilderFixedInputs.envModeKey,
      agentBuilderFixedInputs.envModeValue,
    ]))
    await expect.poll(
      async () => advancedSettings.getByRole('textbox').evaluateAll(inputs =>
        inputs.map(input => (input as HTMLInputElement).value),
      ),
      { timeout: 30_000 },
    ).not.toContain(agentBuilderFixedInputs.envPlainKey)
    await expect(advancedSettings.getByText('Plain', { exact: true })).toHaveCount(1)
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
    await expect(page.getByRole('button', { name: /^Build$/i })).toBeVisible()
  },
)

Then(
  'I should see the Agent v2 environment variables from the invalid import in Advanced Settings',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })

    await page.getByRole('button', { name: 'Advanced Settings' }).first().click()
    await expect(advancedSettings.getByRole('heading', { name: 'Env Editor' })).toBeVisible()
    await expect.poll(
      async () => advancedSettings.getByRole('textbox').evaluateAll(inputs =>
        inputs.map(input => (input as HTMLInputElement).value),
      ),
      { timeout: 30_000 },
    ).toEqual(expect.arrayContaining([
      agentBuilderFixedInputs.envPlainKey,
      agentBuilderFixedInputs.envPlainValue,
      agentBuilderFixedInputs.envAfterInvalidImportKey,
      agentBuilderFixedInputs.envAfterInvalidImportValue,
    ]))
    await expect(page.getByRole('button', { name: /^Build$/i })).toBeVisible()
  },
)

Then('I should see the Agent v2 Build draft pending changes', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByText('Build draft')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible()
})

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
