import type { DefaultModelResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import modelProvider from '@/i18n/locales/en-US/model-provider.json'
import plugin from '@/i18n/locales/en-US/plugin.json'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import SystemModel from '../index'

vi.unmock('react-i18next')

// boundary: default-model reads and writes stop at the generated console transport.
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

beforeEach(() => vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false))
afterEach(() => vi.unstubAllGlobals())

it.each([
  { modelType: 'tts', label: 'Text-to-Speech Model', requiresConfirmation: true },
  { modelType: 'text-embedding', label: 'Embedding Model', requiresConfirmation: false },
  { modelType: 'rerank', label: 'Rerank Model', requiresConfirmation: false },
])(
  'returns focus to the $label selector after clearing',
  async ({ modelType, label, requiresConfirmation }) => {
    // The clear button unmounts on clearing; browser focus must stay on this field in the parent dialog.
    const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
      workspacePermissionKeys: ['plugin.model_config'],
    })
    const i18n = createInstance()
    await i18n.init({
      lng: 'en-US',
      keySeparator: false,
      resources: { 'en-US': { common, modelProvider, plugin } },
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
          <I18nextProvider i18n={i18n}>
            <Wrapper>
              <SystemModel notConfigured={false} />
            </Wrapper>
          </I18nextProvider>
        </NuqsTestingAdapter>,
      )
      await screen.getByRole('button', { name: 'Default Models' }).click()
      const settings = screen.getByRole('dialog', { name: 'Default Model Settings' })
      await settings.getByRole('button', { name: `${label} ${modelType} model` }).hover()
      const clearButton = settings.getByRole('button', { name: `Clear ${label}` })
      const settingsPopup = settings.element()
      await clearButton.click()
      if (requiresConfirmation) {
        const confirmation = screen.getByRole('alertdialog', { name: `Clear ${label}?` })
        await expect.element(confirmation).toBeVisible()
        await expect.element(settingsPopup).toBeVisible()
        await confirmation.getByRole('button', { name: 'Cancel' }).click()
        await expect.element(confirmation).not.toBeInTheDocument()
        await expect.element(clearButton).toHaveFocus()
        await clearButton.click()
        await confirmation.getByRole('button', { name: 'Clear' }).click()
        await expect.element(confirmation).not.toBeInTheDocument()
      } else {
        await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
      }
      await expect.element(clearButton).not.toBeInTheDocument()
      await expect
        .element(settings.getByRole('button', { name: `${label} Configure model` }))
        .toHaveFocus()
    } finally {
      queryClient.clear()
    }
  },
)
