import type { Response } from '@playwright/test'
import type { DifyWorld } from '../../support/world'
import { readFile } from 'node:fs/promises'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import {
  getAgentComposerDraft,
  saveAgentComposerDraft,
} from '../../agent-v2/support/agent'
import { saveAgentBuildDraft } from '../../agent-v2/support/agent-build-draft'
import { agentBuilderFixedInputs, agentBuilderPreseededResources } from '../../agent-v2/support/agent-builder-resources'
import { uploadAgentConfigFileToDraft } from '../../agent-v2/support/agent-drive'
import {
  createAgentSoulConfigWithModel,
  normalAgentPrompt,
  normalAgentSoulConfig,
  updatedAgentPrompt,
  updatedAgentSoulConfig,
} from '../../agent-v2/support/agent-soul'
import { asArray, asRecord, skipBlockedPrecondition } from '../../agent-v2/support/preflight/common'
import { hasToolEntry } from '../../agent-v2/support/preflight/tools'
import { agentBuilderTestMaterials, getAgentBuilderTestMaterialPath } from '../../agent-v2/support/test-materials'
import { getPreseededToolContract } from '../../agent-v2/support/tools'
import {
  getAgentEnvVariableValue,
  getCurrentAgentId,
  uploadSummaryConfigSkillForBuildDraft,
} from './configure-helpers'

Given(
  'an Agent v2 Build draft adds the supported E2E files, skills, and env',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)
    const configFile = await uploadAgentConfigFileToDraft({
      agentId,
      fileName: agentBuilderTestMaterials.smallFile,
      filePath: getAgentBuilderTestMaterialPath('smallFile'),
    })
    const skill = await uploadSummaryConfigSkillForBuildDraft(this)

    if (!configFile.file_id)
      throw new Error('Agent v2 build draft config file fixture did not return a file_id.')
    this.createdAgentConfigFiles.push({ agentId, name: configFile.name })

    const normalConfig = this.agentBuilder.preflight.stableModel
      ? createAgentSoulConfigWithModel(normalAgentSoulConfig, this.agentBuilder.preflight.stableModel)
      : normalAgentSoulConfig
    const updatedConfig = this.agentBuilder.preflight.stableModel
      ? createAgentSoulConfigWithModel(updatedAgentSoulConfig, this.agentBuilder.preflight.stableModel)
      : updatedAgentSoulConfig

    await saveAgentComposerDraft(agentId, normalConfig)
    await saveAgentBuildDraft(agentId, {
      ...updatedConfig,
      config_files: [configFile],
      config_skills: [skill],
      env: {
        secret_refs: [],
        variables: [{
          id: agentBuilderFixedInputs.envPlainKey,
          key: agentBuilderFixedInputs.envPlainKey,
          name: agentBuilderFixedInputs.envPlainKey,
          value: agentBuilderFixedInputs.envPlainValue,
          variable: agentBuilderFixedInputs.envPlainKey,
        }],
      },
    })
  },
)

Given(
  'an Agent v2 Build draft includes the existing e2e-summary-skill Skill',
  async function (this: DifyWorld) {
    const skill = await uploadSummaryConfigSkillForBuildDraft(this)
    const normalConfig = this.agentBuilder.preflight.stableModel
      ? createAgentSoulConfigWithModel(normalAgentSoulConfig, this.agentBuilder.preflight.stableModel)
      : normalAgentSoulConfig
    const updatedConfig = this.agentBuilder.preflight.stableModel
      ? createAgentSoulConfigWithModel(updatedAgentSoulConfig, this.agentBuilder.preflight.stableModel)
      : updatedAgentSoulConfig
    const configSkills = [skill]

    await saveAgentComposerDraft(getCurrentAgentId(this), {
      ...normalConfig,
      config_skills: configSkills,
    })
    await saveAgentBuildDraft(getCurrentAgentId(this), {
      ...updatedConfig,
      config_skills: configSkills,
    })
  },
)

Given('an Agent v2 Build draft uses the updated E2E prompt', async function (this: DifyWorld) {
  await saveAgentBuildDraft(getCurrentAgentId(this), updatedAgentSoulConfig)
})

Given(
  'an Agent v2 Build draft uses the updated E2E prompt with the stable E2E model',
  async function (this: DifyWorld) {
    if (!this.agentBuilder.preflight.stableModel)
      throw new Error('Create an Agent v2 Build draft with a stable model after stable model preflight.')

    await saveAgentBuildDraft(
      getCurrentAgentId(this),
      createAgentSoulConfigWithModel(updatedAgentSoulConfig, this.agentBuilder.preflight.stableModel),
    )
  },
)

When('I generate an Agent v2 Build draft from the fixed instruction', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentId = getCurrentAgentId(this)
  const instruction = (await readFile(getAgentBuilderTestMaterialPath('buildInstruction'), 'utf8')).trim()

  await page.getByRole('button', { name: 'Build' }).click()
  await page.getByPlaceholder('Describe what your agent should do').fill(instruction)

  const checkoutResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith(`/console/api/agent/${agentId}/build-draft/checkout`)
  ))
  const chatResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith(`/console/api/agent/${agentId}/chat-messages`)
  ))

  await page.getByRole('button', { name: 'Start build' }).click()
  expect((await checkoutResponsePromise).ok()).toBe(true)
  expect((await chatResponsePromise).ok()).toBe(true)
  await expect(page.getByText('Build draft')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: 'Discard' })).toBeEnabled()
})

const expectPageResponseOK = async (response: Response, action: string) => {
  if (response.ok())
    return

  let body = ''
  try {
    body = await response.text()
  }
  catch {
    body = '<response body unavailable>'
  }

  const trimmedBody = body.length > 1000 ? `${body.slice(0, 1000)}...` : body
  throw new Error(`${action} failed with ${response.status()} ${response.statusText()} at ${response.url()}: ${trimmedBody}`)
}

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
  await expectPageResponseOK(await finalizeResponsePromise, 'Finalize Agent v2 Build draft')
  await expectPageResponseOK(await applyResponsePromise, 'Apply Agent v2 Build draft')
  await expect(page.getByText('Action succeeded')).toBeVisible()
})

async function skipBuildDraftToolWriteback(world: DifyWorld) {
  return skipBlockedPrecondition(
    world,
    'Build draft Dify Tool writeback is not available: Build draft currently supports files, skills, and env only.',
    {
      owner: 'product',
      remediation: 'Define and implement Build draft Tool writeback before enabling this scenario.',
    },
  )
}

Given('Agent v2 Build chat Dify Tool writeback is available', async function (this: DifyWorld) {
  return skipBuildDraftToolWriteback(this)
})

Then('Agent v2 Build chat Dify Tool writeback should be available', async function (this: DifyWorld) {
  return skipBuildDraftToolWriteback(this)
})

async function skipBuildDraftUnavailableResourceRecovery(world: DifyWorld) {
  return skipBlockedPrecondition(
    world,
    'Build chat unavailable Skill/Tool recovery is not covered: the product needs a stable user-visible failure state and deterministic request fixture before this can be automated.',
    {
      owner: 'product/seed',
      remediation: 'Define the unavailable-resource UX contract, then seed a stable model-backed prompt that requests a missing Skill and Tool without mutating the saved Agent config.',
    },
  )
}

Given('Agent v2 Build chat unavailable Skill and Tool recovery is available', async function (this: DifyWorld) {
  return skipBuildDraftUnavailableResourceRecovery(this)
})

Then('Agent v2 Build chat unavailable Skill and Tool recovery should be available', async function (this: DifyWorld) {
  return skipBuildDraftUnavailableResourceRecovery(this)
})

Then('I should see the Agent v2 Build draft pending changes', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByText('Build draft')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Discard' })).toBeEnabled()
})

Then('I should see the Agent v2 Build mode confirmation state', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByText('Build mode', { exact: true })).toBeVisible()
  await expect(
    page.getByText('You\'re in build mode. Shape this setup through the chat on the right, then Apply.'),
  ).toBeVisible()
})

Then('I should see the e2e-summary-skill Skill in the Skills section', async function (this: DifyWorld) {
  const skillsSection = this.getPage().getByRole('region', { name: 'Skills' })

  await expect(skillsSection).toBeVisible({ timeout: 30_000 })
  await expect(skillsSection.getByRole('button', {
    exact: true,
    name: agentBuilderPreseededResources.summarySkill,
  })).toBeVisible()
})

Then('I should not see the e2e-summary-skill Skill in the Skills section', async function (this: DifyWorld) {
  const skillsSection = this.getPage().getByRole('region', { name: 'Skills' })

  await expect(skillsSection).toBeVisible({ timeout: 30_000 })
  await expect(skillsSection.getByRole('button', {
    exact: true,
    name: agentBuilderPreseededResources.summarySkill,
  })).toHaveCount(0)
})

Then('I should see one e2e-summary-skill Skill in the Skills section', async function (this: DifyWorld) {
  const skillsSection = this.getPage().getByRole('region', { name: 'Skills' })

  await expect(skillsSection).toBeVisible({ timeout: 30_000 })
  await expect(skillsSection.getByRole('button', {
    exact: true,
    name: agentBuilderPreseededResources.summarySkill,
  })).toHaveCount(1)
})

Then(
  'the normal Agent v2 draft should not include the Agent Builder JSON Replace tool',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)
    const tool = getPreseededToolContract(this, agentBuilderPreseededResources.jsonReplaceTool)

    await expect.poll(
      async () => {
        const draft = await getAgentComposerDraft(agentId)
        const tools = asArray(asRecord(draft.agent_soul?.tools).dify_tools)

        return hasToolEntry(tools, tool)
      },
      { timeout: 30_000 },
    ).toBe(false)
  },
)

Then(
  'the Agent v2 draft should include the supported Build draft config',
  async function (this: DifyWorld) {
    await expect.poll(
      async () => {
        const agentSoul = (await getAgentComposerDraft(getCurrentAgentId(this))).agent_soul
        const variables = agentSoul?.env?.variables ?? []

        return {
          envValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envPlainKey),
          fileNames: agentSoul?.config_files?.map(file => file.name) ?? [],
          prompt: agentSoul?.prompt,
          skillNames: agentSoul?.config_skills?.map(skill => skill.name) ?? [],
        }
      },
      { timeout: 30_000 },
    ).toEqual({
      envValue: agentBuilderFixedInputs.envPlainValue,
      fileNames: expect.arrayContaining([agentBuilderTestMaterials.smallFile]),
      prompt: { system_prompt: updatedAgentPrompt },
      skillNames: expect.arrayContaining([agentBuilderPreseededResources.summarySkill]),
    })
  },
)

Then(
  'the Agent v2 draft should not include the supported Build draft config',
  async function (this: DifyWorld) {
    await expect.poll(
      async () => {
        const agentSoul = (await getAgentComposerDraft(getCurrentAgentId(this))).agent_soul
        const variables = agentSoul?.env?.variables ?? []

        return {
          envValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envPlainKey),
          fileNames: agentSoul?.config_files?.map(file => file.name) ?? [],
          prompt: agentSoul?.prompt,
          skillNames: agentSoul?.config_skills?.map(skill => skill.name) ?? [],
        }
      },
      { timeout: 30_000 },
    ).toEqual({
      envValue: undefined,
      fileNames: expect.not.arrayContaining([agentBuilderTestMaterials.smallFile]),
      prompt: { system_prompt: normalAgentPrompt },
      skillNames: expect.not.arrayContaining([agentBuilderPreseededResources.summarySkill]),
    })
  },
)

Then(
  'the Agent v2 draft should include one e2e-summary-skill Skill',
  async function (this: DifyWorld) {
    await expect.poll(
      async () => {
        const agentSoul = (await getAgentComposerDraft(getCurrentAgentId(this))).agent_soul
        return agentSoul?.config_skills?.filter(
          skill => skill.name === agentBuilderPreseededResources.summarySkill,
        ).length ?? 0
      },
      { timeout: 30_000 },
    ).toBe(1)
  },
)

Then('the Agent v2 Build draft should no longer be active', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByText('Build draft')).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Discard' })).not.toBeVisible()
})
