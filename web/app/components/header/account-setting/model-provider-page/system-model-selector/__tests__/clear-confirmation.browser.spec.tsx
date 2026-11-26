import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
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
import { setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { SystemModelDialog } from '../dialog'
import { SystemModelTrigger } from '../trigger'

vi.unmock('react-i18next')

const modelTypes = ['llm', 'text-embedding', 'rerank', 'speech2text', 'tts'] as const
const catalog = createModelCatalogFixture({
  models: modelTypes.map((model_type) =>
    createCatalogModelFixture({
      model: `${model_type}-model`,
      model_type,
      label: { en_US: `${model_type} model` },
    }),
  ),
})

const fake = setupFakeApi({
  console: {
    workspaces: {
      current: {
        defaultModel: {
          get: ({ query: { model_type } }) => ({
            data: createDefaultModelFixture({ model: `${model_type}-model`, model_type }),
          }),
          post: () => ({ result: 'success' }),
        },
        models: {
          modelTypes: {
            byModelType: {
              get: ({ params: { model_type } }) => ({
                data: [
                  {
                    ...catalog,
                    models: catalog.models.filter((model) => model.model_type === model_type),
                  },
                ],
              }),
            },
          },
        },
      },
    },
  },
})

async function renderSettings() {
  const { queryClient, wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['plugin.model_config'],
  })
  onTestFinished(() => queryClient.clear())
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { common, modelProvider, plugin } },
  })
  seedModelProviderQueries(queryClient, [catalog])
  const { NavigationProvider } = createTestNavigation({ url: '/apps' })
  const { wrapper: UrlState } = createNuqsTestWrapper()
  const screen = await render(
    <NavigationProvider>
      <UrlState>
        <I18nextProvider i18n={i18n}>
          <ConsoleProvider>
            <SystemModelTrigger notConfigured={false} />
            <SystemModelDialog />
          </ConsoleProvider>
        </I18nextProvider>
      </UrlState>
    </NavigationProvider>,
  )
  await screen.getByRole('button', { name: 'Default Models' }).click()
  const settings = screen.getByRole('dialog', { name: 'Default Model Settings' })
  await expect.element(settings).toBeVisible()
  return settings
}

it.each([
  { modelType: 'tts', label: 'Text-to-Speech Model', requiresConfirmation: true },
  { modelType: 'text-embedding', label: 'Embedding Model', requiresConfirmation: false },
  { modelType: 'rerank', label: 'Rerank Model', requiresConfirmation: false },
])(
  'returns focus to the $label selector after clearing',
  async ({ modelType, label, requiresConfirmation }) => {
    // The clear button unmounts on clearing; browser focus must stay on this field in the parent dialog.
    const settings = await renderSettings()
    await settings.getByRole('button', { name: `${label} ${modelType} model` }).hover()
    const clearButton = settings.getByRole('button', { name: `Clear ${label}` })
    const settingsPopup = settings.element()
    await clearButton.click()
    if (requiresConfirmation) {
      const confirmation = page.getByRole('alertdialog', { name: `Clear ${label}?` })
      await expect.element(confirmation).toBeVisible()
      await expect.element(settingsPopup).toBeVisible()
      await confirmation.getByRole('button', { name: 'Cancel' }).click()
      await expect.element(confirmation).not.toBeInTheDocument()
      await expect.element(clearButton).toHaveFocus()
      await clearButton.click()
      await confirmation.getByRole('button', { name: 'Clear' }).click()
      await expect.element(confirmation).not.toBeInTheDocument()
    } else {
      await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
    }
    await expect.element(clearButton).not.toBeInTheDocument()
    await expect
      .element(settings.getByRole('button', { name: `${label} Configure model` }))
      .toHaveFocus()
  },
)

it('keeps the model when the clear confirmation is dismissed with Escape', async () => {
  const settings = await renderSettings()
  const selector = settings.getByRole('button', { name: 'System Reasoning Model llm model' })
  await selector.hover()
  const clearButton = settings.getByRole('button', { name: 'Clear System Reasoning Model' })
  await clearButton.click()
  const confirmation = page.getByRole('alertdialog', { name: 'Clear System Reasoning Model?' })
  await expect
    .element(confirmation)
    .toHaveAccessibleDescription(
      'This change takes effect when you save. Workflows that rely on this default model may then fail.',
    )

  await userEvent.keyboard('{Escape}')
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(settings).toBeVisible()
  await expect.element(clearButton).toHaveFocus()
  await expect.element(selector).toBeVisible()
})

it('saves only the cleared defaults as empty', async () => {
  const settings = await renderSettings()
  await settings.getByRole('button', { name: 'Speech-to-Text Model speech2text model' }).hover()
  await settings.getByRole('button', { name: 'Clear Speech-to-Text Model' }).click()
  await page
    .getByRole('alertdialog', { name: 'Clear Speech-to-Text Model?' })
    .getByRole('button', { name: 'Clear' })
    .click()
  await settings.getByRole('button', { name: 'Rerank Model rerank model' }).hover()
  await settings.getByRole('button', { name: 'Clear Rerank Model' }).click()
  await expect
    .element(settings.getByRole('button', { name: 'Rerank Model Configure model' }))
    .toBeVisible()
  expect(fake.console.workspaces.current.defaultModel.post).not.toHaveBeenCalled()

  await settings.getByRole('button', { name: 'Save' }).click()
  await expect.element(settings).not.toBeInTheDocument()
  expect(fake.console.workspaces.current.defaultModel.post).toHaveBeenCalledExactlyOnceWith({
    body: {
      model_settings: modelTypes.map((model_type) =>
        model_type === 'speech2text' || model_type === 'rerank'
          ? { model_type, provider: null, model: null }
          : { model_type, provider: 'openai', model: `${model_type}-model` },
      ),
    },
  })
})
