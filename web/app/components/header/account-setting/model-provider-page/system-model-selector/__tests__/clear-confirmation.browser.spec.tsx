import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import SystemModel from '../index'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.defaultModel.get': async ({
        query: { model_type },
      }: {
        query: { model_type: string }
      }) => ({
        data:
          model_type === 'llm'
            ? createDefaultModelFixture()
            : model_type === 'tts'
              ? createDefaultModelFixture({ model: 'speech-model', model_type: 'tts' })
              : null,
      }),
    }),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock({
      'modelProvider.systemModelSettings': 'System Model Settings',
      'modelProvider.systemModelSettingsTitle': 'Default Model Settings',
      'modelProvider.systemReasoningModel.key': 'System Reasoning Model',
      'modelProvider.ttsModel.key': 'TTS Model',
      'modelProvider.clearDefaultModel.title': 'Clear {{modelType}}?',
      'operation.cancel': 'Cancel',
      'operation.clear': 'Clear',
      'operation.save': 'Save',
    }),
  }
})

beforeEach(() => vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false))
afterEach(() => vi.unstubAllGlobals())

it('keeps the settings behind its nested confirmation and restores focus without losing the draft', async () => {
  // Clearing removes the initiating button; verify native focus recovery and continued keyboard access.
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['plugin.model_config'],
  })
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture(),
        createCatalogModelFixture({
          model: 'speech-model',
          model_type: 'tts',
          label: { en_US: 'Speech model' },
        }),
        createCatalogModelFixture({ model: 'edited-model', label: { en_US: 'Edited model' } }),
      ],
    }),
  ])
  const screen = await render(
    <NuqsTestingAdapter>
      <Wrapper>
        <SystemModel notConfigured={false} />
      </Wrapper>
    </NuqsTestingAdapter>,
  )
  await screen.getByRole('button', { name: 'System Model Settings' }).click()
  const settings = screen.getByRole('dialog', { name: 'Default Model Settings' })
  await expect.element(settings).toBeVisible()
  await settings.getByRole('button', { name: /^GPT-4/ }).click()
  await screen
    .getByRole('dialog', { name: 'plugin.detailPanel.configureModel' })
    .getByRole('button', { name: /^Edited model/ })
    .click()
  await expect.element(settings.getByRole('button', { name: /^Edited model/ })).toBeVisible()

  const settingsPopup = settings.element()
  try {
    await settings.getByRole('button', { name: 'Clear System Reasoning Model' }).click()
    const confirmation = screen.getByRole('alertdialog', { name: 'Clear System Reasoning Model?' })
    await expect.element(confirmation).toBeVisible()
    await expect.element(settingsPopup).toBeVisible()
    await confirmation.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(confirmation).not.toBeInTheDocument()
    await expect.element(settings).toBeVisible()
    await expect.element(settings.getByRole('button', { name: /^Edited model/ })).toBeVisible()
    await expect
      .element(settings.getByRole('button', { name: 'Clear System Reasoning Model' }))
      .toHaveFocus()

    await settings.getByRole('button', { name: 'Clear System Reasoning Model' }).click()
    await expect.element(confirmation).toBeVisible()
    await expect.element(settingsPopup).toBeVisible()
    await confirmation.getByRole('button', { name: 'Clear' }).click()
    await expect.element(confirmation).not.toBeInTheDocument()
    await expect.element(settings).toBeVisible()
    await expect
      .element(settings.getByRole('button', { name: 'Clear System Reasoning Model' }))
      .not.toBeInTheDocument()
    await expect
      .element(settings.getByRole('button', { name: 'plugin.detailPanel.configureModel' }).first())
      .toHaveFocus()
    await userEvent.keyboard('{Tab}')
    expect(settingsPopup.contains(document.activeElement)).toBe(true)
    await settings.getByRole('button', { name: /^Speech model/ }).hover()
    await settings.getByRole('button', { name: 'Clear TTS Model' }).click()
    const ttsConfirmation = screen.getByRole('alertdialog', { name: 'Clear TTS Model?' })
    await expect.element(ttsConfirmation).toBeVisible()
    await ttsConfirmation.getByRole('button', { name: 'Clear' }).click()
    await expect.element(ttsConfirmation).not.toBeInTheDocument()
    await expect
      .element(settings.getByRole('button', { name: 'plugin.detailPanel.configureModel' }).last())
      .toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(settings).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'System Model Settings' }))
      .toHaveFocus()
  } finally {
    queryClient.clear()
  }
})
