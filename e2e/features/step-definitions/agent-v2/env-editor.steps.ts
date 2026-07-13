import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { getAgentComposerDraft } from '../../agent-v2/support/agent'
import { agentBuilderFixedInputs } from '../../agent-v2/support/agent-builder-resources'
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

When(
  'I add the plain Agent v2 environment variable from Advanced Settings',
  async function (this: DifyWorld) {
    const advancedSettings = await openAgentAdvancedSettings(this.getPage())

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
    const advancedSettings = await openAgentAdvancedSettings(this.getPage())

    const fileChooserPromise = this.getPage().waitForEvent('filechooser')
    await advancedSettings.getByRole('button', { name: 'Import .env' }).click()
    await (await fileChooserPromise).setFiles(getAgentBuilderTestMaterialPath('validEnv'))
  },
)

Then(
  'the plain Agent v2 environment variable should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)

    await expect
      .poll(
        async () => {
          const env = (await getAgentComposerDraft(agentId)).agent_soul?.env
          const variable = env?.variables?.find(
            (item) => getEnvVariableKey(item) === agentBuilderFixedInputs.envPlainKey,
          )

          return {
            secretCount: env?.secret_refs?.length ?? 0,
            value: variable?.value,
          }
        },
        {
          timeout: 30_000,
        },
      )
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
      .poll(
        async () => {
          const variables = await getAgentEnvVariables(agentId)

          return {
            modeValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envModeKey),
            plainValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envPlainKey),
          }
        },
        {
          timeout: 30_000,
        },
      )
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
      .poll(
        async () => {
          const variables = await getAgentEnvVariables(agentId)

          return {
            modeValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envModeKey),
            plainValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envPlainKey),
          }
        },
        {
          timeout: 30_000,
        },
      )
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
      .poll(
        async () => {
          const variables = await getAgentEnvVariables(agentId)

          return {
            modeValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envModeKey),
            plainValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envPlainKey),
          }
        },
        {
          timeout: 30_000,
        },
      )
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
      .poll(
        async () => {
          const variables = await getAgentEnvVariables(agentId)

          return {
            importedValue: getAgentEnvVariableValue(
              variables,
              agentBuilderFixedInputs.envAfterInvalidImportKey,
            ),
            plainValue: getAgentEnvVariableValue(variables, agentBuilderFixedInputs.envPlainKey),
          }
        },
        {
          timeout: 30_000,
        },
      )
      .toEqual({
        importedValue: agentBuilderFixedInputs.envAfterInvalidImportValue,
        plainValue: agentBuilderFixedInputs.envPlainValue,
      })
  },
)

Then(
  'I should see the Agent v2 environment variables from the valid import in Advanced Settings',
  async function (this: DifyWorld) {
    const advancedSettings = await openAgentAdvancedSettings(this.getPage())

    await expect
      .poll(
        async () =>
          advancedSettings
            .getByRole('textbox')
            .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
        { timeout: 30_000 },
      )
      .toEqual(
        expect.arrayContaining([
          agentBuilderFixedInputs.envPlainKey,
          agentBuilderFixedInputs.envPlainValue,
          agentBuilderFixedInputs.envModeKey,
          agentBuilderFixedInputs.envModeValue,
        ]),
      )
    await expect(advancedSettings.getByText('Plain', { exact: true })).toHaveCount(2)
  },
)

Then(
  'I should not see the deleted Agent v2 environment variable in Advanced Settings',
  async function (this: DifyWorld) {
    const advancedSettings = await openAgentAdvancedSettings(this.getPage())

    await expect
      .poll(
        async () =>
          advancedSettings
            .getByRole('textbox')
            .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
        { timeout: 30_000 },
      )
      .toEqual(
        expect.arrayContaining([
          agentBuilderFixedInputs.envModeKey,
          agentBuilderFixedInputs.envModeValue,
        ]),
      )
    await expect
      .poll(
        async () =>
          advancedSettings
            .getByRole('textbox')
            .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
        { timeout: 30_000 },
      )
      .not.toContain(agentBuilderFixedInputs.envPlainKey)
    await expect(advancedSettings.getByText('Plain', { exact: true })).toHaveCount(1)
  },
)

Then(
  'I should see the plain Agent v2 environment variable in Advanced Settings',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const advancedSettings = await openAgentAdvancedSettings(page)

    await expect(advancedSettings.getByRole('textbox', { name: 'Key' })).toHaveValue(
      agentBuilderFixedInputs.envPlainKey,
    )
    await expect(advancedSettings.getByRole('textbox', { name: 'Value' })).toHaveValue(
      agentBuilderFixedInputs.envPlainValue,
    )
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
    const advancedSettings = await openAgentAdvancedSettings(page)

    await expect
      .poll(
        async () =>
          advancedSettings
            .getByRole('textbox')
            .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
        { timeout: 30_000 },
      )
      .toEqual(
        expect.arrayContaining([
          agentBuilderFixedInputs.envPlainKey,
          agentBuilderFixedInputs.envPlainValue,
          agentBuilderFixedInputs.envAfterInvalidImportKey,
          agentBuilderFixedInputs.envAfterInvalidImportValue,
        ]),
      )
    await expect(page.getByRole('button', { name: /^Build$/i })).toBeVisible()
  },
)
