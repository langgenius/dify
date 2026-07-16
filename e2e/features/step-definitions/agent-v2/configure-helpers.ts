import type { Locator } from '@playwright/test'
import type { AgentComposerEnvVariable } from '../../agent-v2/support/agent-soul'
import type { DifyWorld } from '../../support/world'
import { expect } from '@playwright/test'
import { getAgentComposerDraft } from '../../agent-v2/support/agent'
import { uploadAgentConfigSkillToDraft } from '../../agent-v2/support/agent-drive'
import { normalAgentPrompt } from '../../agent-v2/support/agent-soul'
import {
  agentBuilderTestMaterials,
  getAgentBuilderTestMaterialPath,
} from '../../agent-v2/support/test-materials'

export const getCurrentAgentId = (world: DifyWorld) => {
  const agentId = world.createdAgentIds.at(-1)
  if (!agentId) throw new Error('No Agent v2 ID found. Create an Agent v2 test agent first.')

  return agentId
}

export const getPreseededAgent = (world: DifyWorld, name: string) => {
  const resource = world.agentBuilder.preflight.preseededResources[name]
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

export const getEnvVariableKey = (variable: AgentComposerEnvVariable) =>
  variable.key ?? variable.name ?? variable.variable

export const getAgentEnvVariableValue = (variables: AgentComposerEnvVariable[], key: string) =>
  variables.find((variable) => getEnvVariableKey(variable) === key)?.value

export const getAgentEnvVariables = async (agentId: string) =>
  (await getAgentComposerDraft(agentId)).agent_soul?.env?.variables ?? []

export const uploadAgentConfigFile = async (
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

  const commitResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith(`/console/api/agent/${agentId}/config/files`),
  )
  await dialog.getByRole('button', { name: 'Upload' }).click()
  const commitResponse = await commitResponsePromise
  expect(commitResponse.status()).toBe(201)
  const committed = (await commitResponse.json()) as { file?: { name?: string } }
  await expect(dialog).not.toBeVisible({ timeout: 30_000 })

  const committedName = committed.file?.name
  if (!committedName)
    throw new Error('Agent config file upload response did not include a file name.')

  world.createdAgentConfigFiles.push({ agentId, name: committedName })
}

export const expectAgentConfigFileVisible = async (
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

export const expectAgentConfigFileHidden = async (
  world: DifyWorld,
  material: keyof typeof agentBuilderTestMaterials,
) => {
  await expect(
    world.getPage().getByRole('button', {
      exact: true,
      name: agentBuilderTestMaterials[material],
    }),
  ).not.toBeVisible()
}

export const expectAgentConfigFileSaved = async (
  world: DifyWorld,
  material: keyof typeof agentBuilderTestMaterials,
  options?: {
    size?: number
  },
) => {
  const agentId = getCurrentAgentId(world)
  const fileName = agentBuilderTestMaterials[material]

  await expect
    .poll(
      async () => {
        const file = (await getAgentComposerDraft(agentId)).agent_soul?.config_files?.find(
          (file) => file.name === fileName,
        )

        return file
          ? {
              name: file.name,
              size: file.size,
            }
          : undefined
      },
      {
        timeout: 30_000,
      },
    )
    .toEqual({
      name: fileName,
      size: options?.size ?? expect.anything(),
    })
}

export const expectAgentModelRequiredFeedback = async (page: ReturnType<DifyWorld['getPage']>) => {
  await expect(page.getByText('Select your model')).toBeVisible({ timeout: 10_000 })
}

export const uploadSummaryConfigSkillForBuildDraft = async (world: DifyWorld) => {
  const agentId = getCurrentAgentId(world)
  const skill = await uploadAgentConfigSkillToDraft({
    agentId,
    fileName: agentBuilderTestMaterials.summarySkill,
    filePath: getAgentBuilderTestMaterialPath('summarySkill'),
  })

  if (!skill.file_id)
    throw new Error('Agent v2 build draft Skill fixture did not return a file_id.')

  world.createdAgentConfigSkills.push({ agentId, name: skill.name })

  return skill
}

export const openAgentAdvancedSettings = async (page: ReturnType<DifyWorld['getPage']>) => {
  const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })
  const trigger = advancedSettings
    .getByRole('heading', { name: 'Advanced Settings' })
    .getByRole('button')
  const envEditorHeading = advancedSettings.getByRole('heading', { name: 'Env Editor' })

  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(envEditorHeading).toBeVisible()

  return advancedSettings
}

export const getAgentEnvVariableRow = (advancedSettings: Locator, key: string) =>
  advancedSettings.getByRole('row', { name: `Key: ${key}`, exact: true })

export const expectAgentEnvVariableVisible = async (
  world: DifyWorld,
  key: string,
  value: string,
) => {
  const advancedSettings = await openAgentAdvancedSettings(world.getPage())
  const variableRow = getAgentEnvVariableRow(advancedSettings, key)

  await expect(variableRow).toContainText(value, { timeout: 30_000 })
  await expect(variableRow.getByText('Plain', { exact: true })).toBeVisible()
}

export const expectAgentEnvVariableHidden = async (world: DifyWorld, key: string) => {
  const advancedSettings = await openAgentAdvancedSettings(world.getPage())

  await expect(getAgentEnvVariableRow(advancedSettings, key)).toHaveCount(0)
}

export const expectNormalAgentPromptDraft = async (world: DifyWorld) => {
  await expect
    .poll(async () => (await getAgentComposerDraft(getCurrentAgentId(world))).agent_soul?.prompt, {
      timeout: 30_000,
    })
    .toEqual({ system_prompt: normalAgentPrompt })
}

export const expectProviderToolActionVisible = async (
  toolsSection: Locator,
  displayName: string,
) => {
  const tool = getPreseededToolDisplayParts(displayName)
  const provider = toolsSection.getByRole('button', {
    exact: true,
    name: tool.providerName,
  })
  await expect(provider).toBeVisible()
  await expect(provider).toHaveAttribute('aria-expanded', 'false')
  await provider.click()
  await expect(provider).toHaveAttribute('aria-expanded', 'true')

  const action = toolsSection.getByText(tool.actionName, { exact: true })
  await expect(action).toBeVisible()

  return { action, tool }
}

export const openAgentKnowledgeRetrievalDialog = async (
  knowledgeSection: Locator,
  name: string,
) => {
  await knowledgeSection.getByText(name, { exact: true }).hover()
  await knowledgeSection
    .getByRole('button', {
      exact: true,
      name: `Edit ${name}`,
    })
    .click()

  const dialog = knowledgeSection.page().getByRole('dialog', {
    name: 'Knowledge Retrieval · Agent decide',
  })
  await expect(dialog).toBeVisible()

  return dialog
}
