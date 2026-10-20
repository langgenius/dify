import type { DefaultModelResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
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
        query: { model_type: DefaultModelResponse['model_type'] }
      }) => ({
        data: createDefaultModelFixture({ model: `${model_type}-model`, model_type }),
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

it('keeps nested settings visible and returns focus to the TTS selector when clearing removes its clear button', async () => {
  // The clear button unmounts on confirmation; browser focus must stay on this field in the parent dialog.
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['plugin.model_config'],
  })
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: (['llm', 'text-embedding', 'rerank', 'speech2text', 'tts'] as const).map(
        (model_type) =>
          createCatalogModelFixture({
            model: `${model_type}-model`,
            model_type,
            label: { en_US: `${model_type} model` },
          }),
      ),
    }),
  ])
  try {
    const screen = await render(
      <NuqsTestingAdapter>
        <Wrapper>
          <SystemModel notConfigured={false} />
        </Wrapper>
      </NuqsTestingAdapter>,
    )
    await screen.getByRole('button', { name: 'System Model Settings' }).click()
    const settings = screen.getByRole('dialog', { name: 'Default Model Settings' })
    await settings.getByRole('button', { name: /^tts model/ }).hover()
    const clearButton = settings.getByRole('button', { name: 'Clear TTS Model' })
    const settingsPopup = settings.element()
    await clearButton.click()
    const confirmation = screen.getByRole('alertdialog', { name: 'Clear TTS Model?' })
    await expect.element(confirmation).toBeVisible()
    await expect.element(settingsPopup).toBeVisible()
    await confirmation.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(confirmation).not.toBeInTheDocument()
    await expect.element(clearButton).toHaveFocus()

    await clearButton.click()
    await confirmation.getByRole('button', { name: 'Clear' }).click()
    await expect.element(confirmation).not.toBeInTheDocument()
    await expect.element(clearButton).not.toBeInTheDocument()
    // All other defaults remain configured, so the only empty selector is the cleared TTS field.
    await expect
      .element(settings.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
      .toHaveFocus()
  } finally {
    queryClient.clear()
  }
})
