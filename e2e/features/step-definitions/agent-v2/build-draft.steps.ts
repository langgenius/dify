import type { Page, Response } from '@playwright/test'
import type { DifyWorld } from '../../support/world'
import { readFile } from 'node:fs/promises'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { getAgentComposerDraft, saveAgentComposerDraft } from '../../agent-v2/support/agent'
import {
  agentBuildDraftExists,
  getAgentBuildDraft,
  saveAgentBuildDraft,
} from '../../agent-v2/support/agent-build-draft'
import {
  agentBuilderFixedInputs,
  agentBuilderPreseededResources,
} from '../../agent-v2/support/agent-builder-resources'
import { uploadAgentConfigFileToDraft } from '../../agent-v2/support/agent-drive'
import {
  createAgentSoulConfigWithModel,
  normalAgentPrompt,
  normalAgentSoulConfig,
  updatedAgentPrompt,
  updatedAgentSoulConfig,
} from '../../agent-v2/support/agent-soul'
import {
  agentBuilderTestMaterials,
  getAgentBuilderTestMaterialPath,
} from '../../agent-v2/support/test-materials'
import {
  expectAgentModelRequiredFeedback,
  getAgentEnvVariableValue,
  getCurrentAgentId,
  uploadSummaryConfigSkillForBuildDraft,
} from './configure-helpers'

const BUILD_DRAFT_RUNTIME_STEP_TIMEOUT_MS = 180_000
const BUILD_DRAFT_NOTE_SYNC_TIMEOUT_MS = 30_000
const BUILD_NOTE_FILE_NAME = 'build_note.md'
const BUILD_NOTE_MARKER = 'E2E_BUILD_DRAFT_PASS'
const BUILD_NOTE_GENERATED_BADGE = 'Generated'

const getBuildDraftBar = (page: Page) => page.getByRole('group', { name: 'Build draft' })

const getBuildNoteFileButton = (page: Page) =>
  page
    .getByRole('region', { name: 'Files' })
    .getByRole('button')
    .filter({ hasText: BUILD_NOTE_FILE_NAME })
    .filter({ hasText: BUILD_NOTE_GENERATED_BADGE })

const getConfigNote = (value: Awaited<ReturnType<typeof getAgentBuildDraft>>) =>
  value.agent_soul?.config_note ?? ''

const getLastBuildChatAnswerText = async (page: Page) => {
  const answer = page.getByTestId('chat-answer-container').last()
  if ((await answer.count()) === 0) return ''

  return (await answer.textContent())?.replace(/\s+/g, ' ').trim() ?? ''
}

const formatBuildChatAnswerText = (text: string) =>
  text.length > 500 ? `${text.slice(0, 500)}...` : text

const saveSupportedBuildDraft = async (
  world: DifyWorld,
  { retainSkillInNormalDraft }: { retainSkillInNormalDraft: boolean },
) => {
  const agentId = getCurrentAgentId(world)
  const configFile = await uploadAgentConfigFileToDraft({
    agentId,
    fileName: agentBuilderTestMaterials.smallFile,
    filePath: getAgentBuilderTestMaterialPath('smallFile'),
  })
  const skill = await uploadSummaryConfigSkillForBuildDraft(world)

  if (!configFile.file_id)
    throw new Error('Agent v2 build draft config file fixture did not return a file_id.')
  world.createdAgentConfigFiles.push({ agentId, name: configFile.name })

  const stableModel = world.agentBuilder.fixtures.stableModel
  const normalConfig = stableModel
    ? createAgentSoulConfigWithModel(normalAgentSoulConfig, stableModel)
    : normalAgentSoulConfig
  const updatedConfig = stableModel
    ? createAgentSoulConfigWithModel(updatedAgentSoulConfig, stableModel)
    : updatedAgentSoulConfig
  const configSkills = [skill]

  await saveAgentComposerDraft(agentId, {
    ...normalConfig,
    ...(retainSkillInNormalDraft ? { config_skills: configSkills } : {}),
  })
  await saveAgentBuildDraft(agentId, {
    ...updatedConfig,
    config_files: [configFile],
    config_skills: configSkills,
    env: {
      secret_refs: [],
      variables: [
        {
          id: agentBuilderFixedInputs.envPlainKey,
          key: agentBuilderFixedInputs.envPlainKey,
          name: agentBuilderFixedInputs.envPlainKey,
          value: agentBuilderFixedInputs.envPlainValue,
          variable: agentBuilderFixedInputs.envPlainKey,
        },
      ],
    },
  })
}

Given(
  'an Agent v2 Build draft adds the supported E2E files, skills, and env',
  async function (this: DifyWorld) {
    await saveSupportedBuildDraft(this, { retainSkillInNormalDraft: false })
  },
)

Given(
  'an Agent v2 Build draft adds supported E2E files and env while retaining the existing Skill',
  async function (this: DifyWorld) {
    await saveSupportedBuildDraft(this, { retainSkillInNormalDraft: true })
  },
)

Given('an Agent v2 Build draft uses the updated E2E prompt', async function (this: DifyWorld) {
  await saveAgentBuildDraft(getCurrentAgentId(this), updatedAgentSoulConfig)
})

Given(
  'an Agent v2 Build draft uses the updated E2E prompt with the stable E2E model',
  async function (this: DifyWorld) {
    if (!this.agentBuilder.fixtures.stableModel)
      throw new Error(
        'Create an Agent v2 Build draft with a stable model after stable model fixture setup.',
      )

    await saveAgentBuildDraft(
      getCurrentAgentId(this),
      createAgentSoulConfigWithModel(
        updatedAgentSoulConfig,
        this.agentBuilder.fixtures.stableModel,
      ),
    )
  },
)

When(
  'I generate an Agent v2 Build draft from the fixed instruction',
  { timeout: BUILD_DRAFT_RUNTIME_STEP_TIMEOUT_MS },
  async function (this: DifyWorld) {
    const page = this.getPage()
    const agentId = getCurrentAgentId(this)
    const instruction = (
      await readFile(getAgentBuilderTestMaterialPath('buildInstruction'), 'utf8')
    ).trim()

    await page.getByRole('button', { exact: true, name: 'Build' }).click()
    await page.getByPlaceholder('Describe what your agent should do').fill(instruction)

    const checkoutResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(
          `/console/api/agent/${agentId}/build-draft/checkout`,
        ),
    )
    const chatResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(`/console/api/agent/${agentId}/chat-messages`),
    )

    await page.getByRole('button', { name: 'Start build' }).click()
    expect((await checkoutResponsePromise).ok()).toBe(true)
    const chatResponse = await chatResponsePromise
    expect(chatResponse.ok()).toBe(true)
    expect(await chatResponse.finished()).toBeNull()

    await expect(page.getByRole('button', { name: 'Stop responding' })).not.toBeVisible()
    await expect(getBuildDraftBar(page)).toBeVisible()
    await expect(page.getByRole('button', { exact: true, name: 'Apply' })).toBeEnabled()
    await expect(page.getByRole('button', { exact: true, name: 'Discard' })).toBeEnabled()
  },
)

When('I try to generate an Agent v2 Build draft without a model', async function (this: DifyWorld) {
  const page = this.getPage()

  await page.getByRole('button', { exact: true, name: 'Build' }).click()
  await page
    .getByPlaceholder('Describe what your agent should do')
    .fill('Update the agent instructions for E2E.')
  await page.getByRole('button', { name: 'Start build' }).click()
})

const expectPageResponseOK = async (response: Response, action: string) => {
  if (response.ok()) return

  let body = ''
  try {
    body = await response.text()
  } catch {
    body = '<response body unavailable>'
  }

  const trimmedBody = body.length > 1000 ? `${body.slice(0, 1000)}...` : body
  throw new Error(
    `${action} failed with ${response.status()} ${response.statusText()} at ${response.url()}: ${trimmedBody}`,
  )
}

When('I discard the Agent v2 Build draft', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentId = getCurrentAgentId(this)

  await page.getByRole('button', { exact: true, name: 'Discard' }).click()
  const confirmDialog = page.getByRole('alertdialog', {
    name: 'Clear session and discard changes?',
  })
  await expect(confirmDialog).toBeVisible()

  const discardResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname.endsWith(`/console/api/agent/${agentId}/build-draft`),
  )

  await confirmDialog.getByRole('button', { name: 'Confirm' }).click()
  await expectPageResponseOK(await discardResponsePromise, 'Discard Agent v2 Build draft')
})

When(
  'I apply the Agent v2 Build draft',
  { timeout: BUILD_DRAFT_RUNTIME_STEP_TIMEOUT_MS },
  async function (this: DifyWorld) {
    const page = this.getPage()
    const agentId = getCurrentAgentId(this)
    const applyButton = page.getByRole('button', { exact: true, name: 'Apply' })

    await expect(applyButton).toBeEnabled({ timeout: 30_000 })
    const finalizeResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(
          `/console/api/agent/${agentId}/build-chat/finalize`,
        ),
      { timeout: 120_000 },
    )
    const applyResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(
          `/console/api/agent/${agentId}/build-draft/apply`,
        ),
      { timeout: 120_000 },
    )

    await applyButton.click()
    await expectPageResponseOK(await finalizeResponsePromise, 'Finalize Agent v2 Build draft')
    await expectPageResponseOK(await applyResponsePromise, 'Apply Agent v2 Build draft')
    await expect(page.getByText('Action succeeded')).toBeVisible()
  },
)

Then('I should see the Agent v2 Build draft pending changes', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(getBuildDraftBar(page)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { exact: true, name: 'Apply' })).toBeEnabled()
  await expect(page.getByRole('button', { exact: true, name: 'Discard' })).toBeEnabled()
})

Then('I should see the Agent v2 Build mode confirmation state', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByText('Build mode', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Configure can only be updated by the agent in this mode.'),
  ).toBeVisible()
  await expect(
    page.getByText('Shape this setup through the chat on the right, then Apply.'),
  ).toBeVisible()
})

Then(
  'the Agent v2 Build draft should include the generated build note',
  async function (this: DifyWorld) {
    try {
      await expect
        .poll(async () => getConfigNote(await getAgentBuildDraft(getCurrentAgentId(this))), {
          timeout: BUILD_DRAFT_NOTE_SYNC_TIMEOUT_MS,
        })
        .toContain(BUILD_NOTE_MARKER)
    } catch (error) {
      const lastAnswerText = await getLastBuildChatAnswerText(this.getPage())
      throw new Error(
        `Agent v2 Build draft note did not include ${BUILD_NOTE_MARKER}. Last Build chat answer: ${formatBuildChatAnswerText(lastAnswerText) || '<empty>'}`,
        { cause: error },
      )
    }
  },
)

Then(
  'I should see the generated Agent v2 build note in Configure',
  async function (this: DifyWorld) {
    await expect(getBuildNoteFileButton(this.getPage())).toBeVisible()
  },
)

Then(
  'Agent v2 Build chat should be blocked until a model is configured',
  async function (this: DifyWorld) {
    await expectAgentModelRequiredFeedback(this.getPage())
  },
)

Then('the Agent v2 Build draft should not be checked out', async function (this: DifyWorld) {
  await expect
    .poll(async () => agentBuildDraftExists(getCurrentAgentId(this)), { timeout: 30_000 })
    .toBe(false)
})

Then(
  'I should see the e2e-summary-skill Skill in the Skills section',
  async function (this: DifyWorld) {
    const skillsSection = this.getPage().getByRole('region', { name: 'Skills' })

    await expect(skillsSection).toBeVisible({ timeout: 30_000 })
    await expect(
      skillsSection.getByRole('button', {
        exact: true,
        name: agentBuilderPreseededResources.summarySkill,
      }),
    ).toBeVisible()
  },
)

Then(
  'I should not see the e2e-summary-skill Skill in the Skills section',
  async function (this: DifyWorld) {
    const skillsSection = this.getPage().getByRole('region', { name: 'Skills' })

    await expect(skillsSection).toBeVisible({ timeout: 30_000 })
    await expect(
      skillsSection.getByRole('button', {
        exact: true,
        name: agentBuilderPreseededResources.summarySkill,
      }),
    ).toHaveCount(0)
  },
)

Then(
  'I should see one e2e-summary-skill Skill in the Skills section',
  async function (this: DifyWorld) {
    const skillsSection = this.getPage().getByRole('region', { name: 'Skills' })

    await expect(skillsSection).toBeVisible({ timeout: 30_000 })
    await expect(
      skillsSection.getByRole('button', {
        exact: true,
        name: agentBuilderPreseededResources.summarySkill,
      }),
    ).toHaveCount(1)
  },
)

Then(
  'the normal Agent v2 draft should not include the generated build note',
  async function (this: DifyWorld) {
    await expect
      .poll(
        async () =>
          (await getAgentComposerDraft(getCurrentAgentId(this))).agent_soul?.config_note ?? '',
        { timeout: 30_000 },
      )
      .not.toContain(BUILD_NOTE_MARKER)
  },
)

Then(
  'the Agent v2 draft should include the supported Build draft config',
  async function (this: DifyWorld) {
    await expect
      .poll(
        async () => {
          const agentSoul = (await getAgentComposerDraft(getCurrentAgentId(this))).agent_soul
          const variables = agentSoul?.env?.variables ?? []

          return {
            envValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envPlainKey),
            fileNames: agentSoul?.config_files?.map((file) => file.name) ?? [],
            prompt: agentSoul?.prompt,
            skillNames: agentSoul?.config_skills?.map((skill) => skill.name) ?? [],
          }
        },
        { timeout: 30_000 },
      )
      .toEqual({
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
    await expect
      .poll(
        async () => {
          const agentSoul = (await getAgentComposerDraft(getCurrentAgentId(this))).agent_soul
          const variables = agentSoul?.env?.variables ?? []

          return {
            envValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envPlainKey),
            fileNames: agentSoul?.config_files?.map((file) => file.name) ?? [],
            prompt: agentSoul?.prompt,
            skillNames: agentSoul?.config_skills?.map((skill) => skill.name) ?? [],
          }
        },
        { timeout: 30_000 },
      )
      .toEqual({
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
    await expect
      .poll(
        async () => {
          const agentSoul = (await getAgentComposerDraft(getCurrentAgentId(this))).agent_soul
          return (
            agentSoul?.config_skills?.filter(
              (skill) => skill.name === agentBuilderPreseededResources.summarySkill,
            ).length ?? 0
          )
        },
        { timeout: 30_000 },
      )
      .toBe(1)
  },
)

Then('the Agent v2 Build draft should no longer be active', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(getBuildDraftBar(page)).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Discard' })).not.toBeVisible()
})
