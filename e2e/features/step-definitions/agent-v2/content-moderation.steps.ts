import type { Locator } from '@playwright/test'
import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { getAgentComposerDraft } from '../../agent-v2/support/agent'
import { agentBuilderFixedInputs } from '../../agent-v2/support/agent-builder-resources'
import { skipBlockedPrecondition } from '../../agent-v2/support/preflight/common'
import { getCurrentAgentId } from './configure-helpers'

const getModerationSettingsDialog = (world: DifyWorld) =>
  world.getPage().getByRole('dialog').filter({ hasText: 'Content moderation settings' })

const getContentModerationRegion = (world: DifyWorld) =>
  world.getPage().getByRole('region', { name: 'Content moderation' })

const ensureSwitchChecked = async (switchLocator: Locator) => {
  if ((await switchLocator.getAttribute('aria-checked')) !== 'true') await switchLocator.click()
}

When(
  'I configure Agent v2 Content Moderation keyword preset replies',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const contentModeration = getContentModerationRegion(this)
    const enabledSwitch = contentModeration.getByRole('switch', { name: 'Content moderation' })

    if ((await enabledSwitch.getAttribute('aria-checked')) === 'true')
      await contentModeration.getByRole('button', { name: 'Settings' }).click()
    else await enabledSwitch.click()

    const dialog = getModerationSettingsDialog(this)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Keywords' }).click()
    await dialog
      .getByRole('textbox', { name: 'Keywords' })
      .fill(agentBuilderFixedInputs.moderationKeyword)

    const inputModeration = dialog.getByRole('region', { name: 'Moderate INPUT Content' })
    const outputModeration = dialog.getByRole('region', { name: 'Moderate OUTPUT Content' })
    await ensureSwitchChecked(
      inputModeration.getByRole('switch', { name: 'Moderate INPUT Content' }),
    )

    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Preset replies cannot be empty')).toBeVisible()
    await expect(dialog).toBeVisible()

    await inputModeration
      .getByRole('textbox', { name: 'Preset replies' })
      .fill(agentBuilderFixedInputs.inputModerationReply)
    await ensureSwitchChecked(
      outputModeration.getByRole('switch', { name: 'Moderate OUTPUT Content' }),
    )
    await outputModeration
      .getByRole('textbox', { name: 'Preset replies' })
      .fill(agentBuilderFixedInputs.outputModerationReply)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).not.toBeVisible()
  },
)

Then('Agent v2 Content Moderation Settings should be available', async function (this: DifyWorld) {
  const advancedSettings = this.getPage().getByRole('region', { name: 'Advanced Settings' })
  const contentModeration = advancedSettings.getByRole('region', { name: 'Content moderation' })

  try {
    await expect(contentModeration).toBeVisible({ timeout: 3_000 })
  } catch {
    return skipBlockedPrecondition(
      this,
      'Agent v2 Content Moderation Settings is not available in this build.',
      {
        owner: 'product',
        remediation:
          'Enable the Agent v2 Content Moderation feature flag in the product or keep this scenario feature-gated.',
      },
    )
  }
})

Then(
  'Agent v2 Content Moderation keyword preset replies should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)

    await expect
      .poll(
        async () => {
          const draft = await getAgentComposerDraft(agentId)
          const appFeatures = draft.agent_soul?.app_features as Record<string, unknown> | undefined
          const moderation = appFeatures?.sensitive_word_avoidance as
            | Record<string, unknown>
            | undefined
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
        },
        {
          timeout: 30_000,
        },
      )
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
    await expect(dialog.getByRole('textbox', { name: 'Keywords' })).toHaveValue(
      agentBuilderFixedInputs.moderationKeyword,
    )
    await expect(
      dialog
        .getByRole('region', { name: 'Moderate INPUT Content' })
        .getByRole('textbox', { name: 'Preset replies' }),
    ).toHaveValue(agentBuilderFixedInputs.inputModerationReply)
    await expect(
      dialog
        .getByRole('region', { name: 'Moderate OUTPUT Content' })
        .getByRole('textbox', { name: 'Preset replies' }),
    ).toHaveValue(agentBuilderFixedInputs.outputModerationReply)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).not.toBeVisible()
  },
)
