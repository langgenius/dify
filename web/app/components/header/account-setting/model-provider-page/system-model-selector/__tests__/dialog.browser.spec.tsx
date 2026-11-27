import type { ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import modelProvider from '@/i18n/locales/en-US/model-provider.json'
import plugin from '@/i18n/locales/en-US/plugin.json'
import { consoleQuery } from '@/service/console'
import { createMutationInvalidation } from '@/service/console/mutation-invalidation'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { SystemModelDialog } from '../dialog'
import { SystemModelTrigger } from '../trigger'

vi.unmock('react-i18next')

const modelTypes = ['llm', 'text-embedding', 'rerank', 'speech2text', 'tts'] as const
type ModelType = (typeof modelTypes)[number]

const selectorLabels: Record<ModelType, string> = {
  llm: 'System Reasoning Model',
  'text-embedding': 'Embedding Model',
  rerank: 'Rerank Model',
  speech2text: 'Speech-to-Text Model',
  tts: 'Text-to-Speech Model',
}

// No TTS model is installed, so that selector shows the empty state.
const catalog = [
  createModelCatalogFixture({
    models: [
      createCatalogModelFixture({ model: 'gpt-4', label: { en_US: 'GPT-4' } }),
      createCatalogModelFixture({ model: 'gpt-4o', label: { en_US: 'GPT-4o' } }),
      createCatalogModelFixture({
        model: 'embedding-1',
        model_type: 'text-embedding',
        label: { en_US: 'Embedding One' },
      }),
    ],
  }),
]

type DefaultModel = ReturnType<typeof createDefaultModelFixture>

let serverDefaults: Partial<Record<ModelType, DefaultModel>>

beforeEach(() => {
  serverDefaults = { llm: createDefaultModelFixture() }
})

const fake = setupFakeApi({
  console: {
    workspaces: {
      current: {
        defaultModel: {
          get: ({ query: { model_type } }) => ({
            data: serverDefaults[model_type as ModelType] ?? null,
          }),
          post: () => ({ result: 'success' }),
        },
        models: {
          modelTypes: {
            byModelType: {
              get: ({ params: { model_type } }) => ({
                data: catalog
                  .map((provider) => ({
                    ...provider,
                    models: provider.models.filter((model) => model.model_type === model_type),
                  }))
                  .filter((provider) => provider.models.length > 0),
              }),
            },
          },
        },
      },
    },
  },
})

const savedSettings = (overrides: Partial<Record<ModelType, string | null>> = {}) => ({
  body: {
    model_settings: modelTypes.map((model_type) => {
      const model =
        model_type in overrides ? overrides[model_type] : model_type === 'llm' ? 'gpt-4' : null
      return { model_type, provider: model ? 'openai' : null, model: model ?? null }
    }),
  },
})

const defaultModelKey = (model_type: ModelType) =>
  consoleQuery.workspaces.current.defaultModel.get.queryKey({ input: { query: { model_type } } })

async function renderSettings({
  workspacePermissionKeys = ['plugin.model_config'],
  cachedDefaults = {},
  unloadedModelList,
  children,
}: {
  workspacePermissionKeys?: string[]
  cachedDefaults?: Partial<Record<ModelType, DefaultModel>>
  unloadedModelList?: ModelType
  children?: ReactNode
} = {}) {
  const { queryClient, wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    // Like the app's client: a write refreshes its domain in the background.
    queryClient: createConsoleQueryClient({ invalidation: createMutationInvalidation() }),
    workspacePermissionKeys,
  })
  onTestFinished(() => queryClient.clear())
  seedModelProviderQueries(queryClient, catalog)
  for (const [model_type, data] of Object.entries(cachedDefaults))
    queryClient.setQueryData(defaultModelKey(model_type as ModelType), { data })
  if (unloadedModelList) {
    queryClient.removeQueries({
      queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type: unloadedModelList } },
      }),
    })
  }
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { common, modelProvider, plugin } },
  })
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper()
  const screen = await render(
    <UrlState>
      <I18nextProvider i18n={i18n}>
        <ConsoleProvider>
          <SystemModelTrigger notConfigured={false} />
          <SystemModelDialog />
          {children}
        </ConsoleProvider>
      </I18nextProvider>
    </UrlState>,
  )
  const trigger = screen.getByRole('button', { name: 'Default Models' })
  const dialog = page.getByRole('dialog', { name: 'Default Model Settings' })
  const selector = (type: ModelType, value: string) =>
    dialog.getByRole('button', { name: `${selectorLabels[type]} ${value}` })
  const open = async () => {
    await trigger.click()
    await expect.element(dialog).toBeVisible()
  }
  return { queryClient, onUrlUpdate, trigger, dialog, selector, open }
}

async function clearSystemReasoningModel(
  dialog: ReturnType<typeof page.getByRole>,
  selector: (type: ModelType, value: string) => ReturnType<typeof page.getByRole>,
) {
  await selector('llm', 'GPT-4').hover()
  await dialog.getByRole('button', { name: 'Clear System Reasoning Model' }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'Clear System Reasoning Model?' })
  await confirmation.getByRole('button', { name: 'Clear' }).click()
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(selector('llm', 'Configure model')).toBeVisible()
}

it('opens from the trigger and reflects the open state on it', async () => {
  const { trigger, dialog, open } = await renderSettings()
  await expect.element(trigger).toHaveAttribute('aria-haspopup', 'dialog')
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
  const triggerElement = trigger.element()
  // The dialog is mounted globally, so nothing may load before it opens.
  expect(fake.console.workspaces.current.defaultModel.get).not.toHaveBeenCalled()
  expect(fake.console.workspaces.current.models.modelTypes.byModelType.get).not.toHaveBeenCalled()

  await open()
  await expect.element(triggerElement).toHaveAttribute('aria-expanded', 'true')

  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect.element(trigger).toHaveFocus()
})

it('keeps editing and saving blocked until every default has loaded, treating null as loaded', async () => {
  const { queryClient, dialog, selector, open } = await renderSettings()
  const getDefault = fake.console.workspaces.current.defaultModel.get
  const request = hold(getDefault)

  await open()
  const {
    query: { model_type },
  } = await request.arrived
  // The other four defaults have been answered and stored; only the held one is still loading.
  await expect
    .poll(() => getDefault.mock.settledResults.filter(({ type }) => type === 'fulfilled'))
    .toHaveLength(4)
  await expect
    .poll(() =>
      queryClient.isFetching({ queryKey: consoleQuery.workspaces.current.defaultModel.get.key() }),
    )
    .toBe(1)
  await expect.element(dialog.getByRole('status', { name: 'Loading' })).toBeVisible()
  await expect.element(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect.element(selector('llm', 'GPT-4')).not.toBeInTheDocument()

  request.resolve({ data: null })
  const unloaded = selector(model_type as ModelType, 'Configure model')
  await expect.element(unloaded).toBeEnabled()
  await expect.element(dialog.getByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
  await expect.element(dialog.getByRole('button', { name: 'Save' })).toBeEnabled()
  await selector('text-embedding', 'Configure model').click()
  await page.getByRole('button', { name: /^Embedding One/ }).click()
  await expect.element(selector('text-embedding', 'Embedding One')).toBeVisible()
})

it('shows loading instead of an empty selector while a model list loads', async () => {
  const { dialog, selector, open } = await renderSettings({ unloadedModelList: 'text-embedding' })
  const request = hold(fake.console.workspaces.current.models.modelTypes.byModelType.get)

  await open()
  expect(await request.arrived).toEqual({ params: { model_type: 'text-embedding' } })
  await expect.element(selector('llm', 'GPT-4')).not.toBeInTheDocument()
  await expect.element(dialog.getByRole('status', { name: 'Loading' })).toBeVisible()
  await expect.element(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()

  request.release()
  await expect.element(selector('text-embedding', 'Configure model')).toBeVisible()
  await expect.element(dialog.getByRole('button', { name: 'Save' })).toBeEnabled()
})

it('shows the failure of a default request instead of stale defaults and retries it', async () => {
  // The cache already holds an earlier default, which must not be offered for editing.
  const { dialog, selector, open } = await renderSettings({
    cachedDefaults: { llm: createDefaultModelFixture() },
  })
  let llmFailures = 0
  fake.console.workspaces.current.defaultModel.get.mockImplementation(
    ({ query: { model_type } }) => {
      if (model_type === 'llm' && llmFailures++ === 0)
        throw apiError({ status: 500, message: 'Unable to refresh defaults' })
      return { data: serverDefaults[model_type as ModelType] ?? null }
    },
  )

  await open()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Unable to refresh defaults')
  await expect.element(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect.element(selector('llm', 'GPT-4')).not.toBeInTheDocument()

  serverDefaults.llm = createDefaultModelFixture({ model: 'gpt-4o' })
  await dialog.getByRole('button', { name: 'Retry' }).click()
  await expect.element(selector('llm', 'GPT-4o')).toBeVisible()
  await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument()
  await expect.element(dialog.getByRole('button', { name: 'Save' })).toBeEnabled()
})

// Stands in for the rest of the console, which keeps showing defaults and model lists after saving.
function ModelSettingsConsumers() {
  useQueries({
    queries: modelTypes.flatMap((model_type) => [
      consoleQuery.workspaces.current.defaultModel.get.queryOptions({
        input: { query: { model_type } },
      }),
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
        input: { params: { model_type } },
      }),
    ]),
  })
  return null
}

it('saves the selected models for every model type, closes and refreshes them', async () => {
  const { dialog, selector, open } = await renderSettings({
    children: <ModelSettingsConsumers />,
  })
  const getDefault = fake.console.workspaces.current.defaultModel.get
  const getModelList = fake.console.workspaces.current.models.modelTypes.byModelType.get
  await open()

  await selector('llm', 'GPT-4').click()
  await page.getByRole('button', { name: /^GPT-4o/ }).click()
  await selector('text-embedding', 'Configure model').click()
  await page.getByRole('button', { name: /^Embedding One/ }).click()
  await expect.element(selector('text-embedding', 'Embedding One')).toBeVisible()
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect.element(dialog).not.toBeInTheDocument()
  expect(fake.console.workspaces.current.defaultModel.post).toHaveBeenCalledExactlyOnceWith(
    savedSettings({ llm: 'gpt-4o', 'text-embedding': 'embedding-1' }),
  )
  // Five defaults loaded on open, then all five are read again after saving (the policy and
  // the invalidation fallback may each read them).
  await expect.poll(() => getDefault.mock.calls.length).toBeGreaterThanOrEqual(10)
  // The fallback refreshes every mounted model list, including the two that changed.
  await expect
    .poll(() => getModelList.mock.calls.map(([{ params }]) => params.model_type))
    .toEqual(expect.arrayContaining(['llm', 'text-embedding']))
})

it('keeps the edited draft when the defaults refresh in the background', async () => {
  const { queryClient, dialog, selector, open } = await renderSettings()
  await open()
  await selector('llm', 'GPT-4').click()
  await page.getByRole('button', { name: /^GPT-4o/ }).click()
  await expect.element(selector('llm', 'GPT-4o')).toBeVisible()

  serverDefaults.llm = createDefaultModelFixture({ model: 'gpt-4-turbo' })
  await queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.defaultModel.get.key(),
  })
  expect(fake.console.workspaces.current.defaultModel.get).toHaveBeenCalledTimes(10)

  await expect.element(selector('llm', 'GPT-4o')).toBeVisible()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(fake.console.workspaces.current.defaultModel.post).toHaveBeenCalledExactlyOnceWith(
    savedSettings({ llm: 'gpt-4o' }),
  )
})

it('cannot be dismissed or edited while saving', async () => {
  const { trigger, dialog, selector, open } = await renderSettings()
  await expect.element(trigger).toBeVisible()
  const triggerElement = trigger.element()
  const request = hold(fake.console.workspaces.current.defaultModel.post)
  await open()
  const save = dialog.getByRole('button', { name: 'Save' })
  await save.click()
  await request.arrived

  await expect.element(save).toHaveAttribute('aria-disabled', 'true')
  await expect.element(save).toHaveFocus()
  await expect.element(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await expect.element(dialog.getByRole('button', { name: 'Close' })).toBeDisabled()
  await expect.element(selector('llm', 'GPT-4')).toBeDisabled()
  await userEvent.keyboard('{Enter}')
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).toBeVisible()
  await expect.element(triggerElement).toHaveAttribute('aria-expanded', 'true')

  request.resolve({ result: 'success' })
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(fake.console.workspaces.current.defaultModel.post).toHaveBeenCalledOnce()
})

it.each([
  {
    failure: 'an API error',
    respond: () => {
      throw apiError({ status: 500, message: 'Unable to save model settings' })
    },
    message: 'Unable to save model settings',
  },
  {
    failure: 'an unsuccessful result',
    respond: () => ({ result: 'failed' }),
    message: 'Modified unsuccessfully',
  },
])('keeps the dialog and draft after $failure and saves again', async ({ respond, message }) => {
  const { dialog, selector, open } = await renderSettings()
  fake.console.workspaces.current.defaultModel.post.mockImplementationOnce(respond)
  await open()
  await clearSystemReasoningModel(dialog, selector)

  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent(message)
  await expect.element(selector('llm', 'Configure model')).toBeVisible()
  await expect.element(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled()

  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(fake.console.workspaces.current.defaultModel.post).toHaveBeenCalledTimes(2)
  expect(fake.console.workspaces.current.defaultModel.post).toHaveBeenLastCalledWith(
    savedSettings({ llm: null }),
  )
})

it('starts a new session with the latest defaults after closing', async () => {
  const { dialog, selector, open } = await renderSettings()
  fake.console.workspaces.current.defaultModel.post.mockImplementationOnce(() => {
    throw apiError({ status: 500, message: 'Unable to save model settings' })
  })
  await open()
  await clearSystemReasoningModel(dialog, selector)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect.element(dialog.getByRole('alert')).toBeVisible()

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  serverDefaults.llm = createDefaultModelFixture({ model: 'gpt-4o' })
  await open()

  await expect.element(selector('llm', 'GPT-4o')).toBeVisible()
  await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument()
  expect(fake.console.workspaces.current.defaultModel.post).toHaveBeenCalledOnce()
})

it('lets a workspace member without model configuration view but not change defaults', async () => {
  const { dialog, selector, open } = await renderSettings({ workspacePermissionKeys: [] })
  await open()

  await selector('llm', 'GPT-4').hover()
  await expect
    .element(dialog.getByRole('button', { name: 'Clear System Reasoning Model' }))
    .not.toBeInTheDocument()
  await expect.element(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
})

it.each([
  { action: 'Model Provider Settings', type: 'llm', value: 'GPT-4' },
  { action: 'Configure', type: 'tts', value: 'Configure model' },
] as const)(
  'closes the dialog and opens provider settings from the selector $action action',
  async ({ action, type, value }) => {
    const { dialog, selector, open, onUrlUpdate } = await renderSettings()
    await open()

    await selector(type, value).click()
    await page.getByRole('button', { name: action }).click()

    await expect.element(dialog).not.toBeInTheDocument()
    await expect
      .poll(() => onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings'))
      .toBe('provider')
  },
)
