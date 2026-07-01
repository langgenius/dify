import type { Locator } from '@playwright/test'
import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { getAgentComposerDraft } from '../../agent-v2/support/agent'
import { agentBuilderFixedInputs } from '../../agent-v2/support/agent-builder-resources'
import { skipBlockedPrecondition } from '../../agent-v2/support/preflight/common'
import { getAgentBuilderTestMaterialPath } from '../../agent-v2/support/test-materials'
import {
  expectAgentEnvVariableHidden,
  expectAgentEnvVariableVisible,
  getAgentEnvVariables,
  getAgentEnvVariableValue,
  getCurrentAgentId,
  getEnvVariableKey,
  openAgentAdvancedSettings,
} from './configure-helpers'

const getModerationSettingsDialog = (world: DifyWorld) =>
  world.getPage().getByRole('dialog').filter({ hasText: 'Content moderation settings' })

const getContentModerationRegion = (world: DifyWorld) =>
  world.getPage().getByRole('region', { name: 'Content moderation' })

const ensureSwitchChecked = async (switchLocator: Locator) => {
  if (await switchLocator.getAttribute('aria-checked') !== 'true')
    await switchLocator.click()
}

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

When(
  'I configure Agent v2 Content Moderation keyword preset replies',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const contentModeration = getContentModerationRegion(this)
    const enabledSwitch = contentModeration.getByRole('switch', { name: 'Content moderation' })

    if (await enabledSwitch.getAttribute('aria-checked') === 'true')
      await contentModeration.getByRole('button', { name: 'Settings' }).click()
    else
      await enabledSwitch.click()

    const dialog = getModerationSettingsDialog(this)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Keywords' }).click()
    await dialog
      .getByRole('textbox', { name: 'Keywords' })
      .fill(agentBuilderFixedInputs.moderationKeyword)

    const inputModeration = dialog.getByRole('region', { name: 'Moderate INPUT Content' })
    const outputModeration = dialog.getByRole('region', { name: 'Moderate OUTPUT Content' })
    await ensureSwitchChecked(inputModeration.getByRole('switch', { name: 'Moderate INPUT Content' }))

    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Preset replies cannot be empty')).toBeVisible()
    await expect(dialog).toBeVisible()

    await inputModeration
      .getByRole('textbox', { name: 'Preset replies' })
      .fill(agentBuilderFixedInputs.inputModerationReply)
    await ensureSwitchChecked(outputModeration.getByRole('switch', { name: 'Moderate OUTPUT Content' }))
    await outputModeration
      .getByRole('textbox', { name: 'Preset replies' })
      .fill(agentBuilderFixedInputs.outputModerationReply)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).not.toBeVisible()
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

Then('Agent v2 Content Moderation Settings should be available', async function (this: DifyWorld) {
  const advancedSettings = this.getPage().getByRole('region', { name: 'Advanced Settings' })
  const contentModeration = advancedSettings.getByRole('region', { name: 'Content moderation' })

  try {
    await expect(contentModeration).toBeVisible({ timeout: 3_000 })
  }
  catch {
    return skipBlockedPrecondition(
      this,
      'Agent v2 Content Moderation Settings is not available in this build.',
      {
        owner: 'product',
        remediation: 'Enable ENABLE_AGENT_CONTENT_MODERATION or keep this scenario feature-gated.',
      },
    )
  }
})

Then(
  'Agent v2 Content Moderation keyword preset replies should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)

    await expect
      .poll(async () => {
        const draft = await getAgentComposerDraft(agentId)
        const appFeatures = draft.agent_soul?.app_features as Record<string, unknown> | undefined
        const moderation = appFeatures?.sensitive_word_avoidance as Record<string, unknown> | undefined
        const config = moderation?.config as Record<string, unknown> | undefined
        const inputsConfig = config?.inputs_config as Record<string, unknown> | undefined
        const outputsConfig = config?.outputs_config as Record<string, unknown> | undefined

        return {
          enabled: moderation?.enabled,
          inputEnabled: inputsConfig?.enabled,
          inputPreset: inputsConfig?.preset_response,
          keywords: config?.keywords,
          outputEnabled: outputsConfig?.enabled,
          outputPreset: outputsConfig?.preset_response,
          type: moderation?.type,
        }
      }, {
        timeout: 30_000,
      })
      .toEqual({
        enabled: true,
        inputEnabled: true,
        inputPreset: agentBuilderFixedInputs.inputModerationReply,
        keywords: agentBuilderFixedInputs.moderationKeyword,
        outputEnabled: true,
        outputPreset: agentBuilderFixedInputs.outputModerationReply,
        type: 'keywords',
      })
  },
)

Then(
  'I should see the Agent v2 Content Moderation keyword preset replies in Advanced Settings',
  async function (this: DifyWorld) {
    const contentModeration = getContentModerationRegion(this)

    await expect(contentModeration).toContainText('Keywords')
    await expect(contentModeration).toContainText('INPUT & OUTPUT')
    await contentModeration.getByRole('button', { name: 'Settings' }).click()

    const dialog = getModerationSettingsDialog(this)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Keywords' }))
      .toHaveValue(agentBuilderFixedInputs.moderationKeyword)
    await expect(dialog.getByRole('region', { name: 'Moderate INPUT Content' })
      .getByRole('textbox', { name: 'Preset replies' }))
      .toHaveValue(agentBuilderFixedInputs.inputModerationReply)
    await expect(dialog.getByRole('region', { name: 'Moderate OUTPUT Content' })
      .getByRole('textbox', { name: 'Preset replies' }))
      .toHaveValue(agentBuilderFixedInputs.outputModerationReply)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).not.toBeVisible()
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
    const advancedSettings = await openAgentAdvancedSettings(page)

    await expect(advancedSettings.getByRole('textbox', { name: 'Key' }))
      .toHaveValue(agentBuilderFixedInputs.envPlainKey)
    await expect(advancedSettings.getByRole('textbox', { name: 'Value' }))
      .toHaveValue(agentBuilderFixedInputs.envPlainValue)
    await expect(advancedSettings.getByText('Plain', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Build$/i })).toBeVisible()
  },
)

Then(
  'I should see the supported E2E environment variable in Advanced Settings',
  async function (this: DifyWorld) {
    await expectAgentEnvVariableVisible(
      this,
      agentBuilderFixedInputs.envPlainKey,
      agentBuilderFixedInputs.envPlainValue,
    )
  },
)

Then(
  'I should not see the supported E2E environment variable in Advanced Settings',
  async function (this: DifyWorld) {
    await expectAgentEnvVariableHidden(this, agentBuilderFixedInputs.envPlainKey)
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
