import type {
  ProviderModelWithStatusEntity,
  ProviderWithModelsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  ConfigurationMethodEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import {
  createModelCreditsFixture,
  createProviderSummaryFixture,
} from '@/test/console/model-provider'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as renderConsole,
} from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import ModelParameterModal from '../index'

const requests = vi.hoisted(() => ({
  models: vi.fn(),
  rules: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  const rules = {
    'workspaces.current.modelProviders.byProvider.models.parameterRules.get': requests.rules,
  }
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      ...rules,
      'workspaces.current.models.modelTypes.byModelType.get': requests.models,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, rules),
  }
})
vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return {
    ...actual,
    toast: Object.assign(() => {}, actual.toast, {
      warning: requests.warning,
      error: requests.error,
    }),
  }
})

const createModelItem = (
  overrides: Partial<ProviderModelWithStatusEntity> = {},
): ProviderModelWithStatusEntity => ({
  model: 'test-model',
  label: { en_US: overrides.model ?? 'Test Model' },
  model_type: ModelTypeEnum.textGeneration,
  features: [],
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: { mode: 'chat' },
  load_balancing_enabled: false,
  ...overrides,
})

/**
 * Factory function to create a ProviderWithModelsResponse (provider with models) with defaults
 */
const createModel = (
  overrides: Partial<ProviderWithModelsResponse> = {},
): ProviderWithModelsResponse => ({
  tenant_id: 'test-workspace',
  provider: 'openai',
  icon_small: { en_US: 'icon-small.png', zh_Hans: 'icon-small.png' },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  models: [createModelItem()],
  status: ModelStatusEnum.active,
  ...overrides,
})

const types = [
  ModelTypeEnum.textGeneration,
  ModelTypeEnum.textEmbedding,
  ModelTypeEnum.rerank,
  ModelTypeEnum.moderation,
  ModelTypeEnum.speech2text,
  ModelTypeEnum.tts,
]
let modelLists: Partial<Record<ModelTypeEnum, ProviderWithModelsResponse[]>>
const selected = { provider: 'openai', model: 'gpt-4', model_type: 'llm', mode: 'chat' }
const settings = () =>
  screen.getByRole('button', { name: 'modelProvider.modelProvider.modelSettings' })
const defaults = { isAdvancedMode: false, setModel: vi.fn() }

const renderWithConsoleQuery = createNuqsTestRenderer((ui) => {
  const queryClient = createConsoleQueryClient()
  const providers = [
    ...new Map(
      Object.values(modelLists)
        .flat()
        .map((provider) => [provider.provider, provider]),
    ).values(),
  ]
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(), {
    data: providers.map((provider) =>
      createProviderSummaryFixture({ provider: provider.provider, label: provider.label }),
    ),
    plugins: {},
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(),
    createModelCreditsFixture(),
  )
  return renderConsole(ui, { queryClient, systemFeatures: { enable_marketplace: false } })
})
const modelTrigger = () =>
  screen.getByRole('button', {
    name: /plugin\.detailPanel\.configureModel|gpt-4|removed-model|tts-1/,
  })

beforeEach(() => {
  vi.clearAllMocks()
  modelLists = {
    [ModelTypeEnum.textGeneration]: [
      createModel({ models: [createModelItem({ model: 'gpt-4' })] }),
    ],
  }
  requests.models.mockImplementation(({ params }: { params: { model_type: ModelTypeEnum } }) =>
    Promise.resolve({ data: modelLists[params.model_type] ?? [] }),
  )
  requests.rules.mockResolvedValue({
    data: [
      {
        name: 'temperature',
        label: { en_US: 'Temperature', zh_Hans: 'Temperature' },
        type: 'float',
        min: 0,
        max: 2,
        default: 0.7,
        required: false,
      },
    ],
  })
})

describe('Plugin model configuration', () => {
  it.each([...types, 'all'])('offers models from the %s scope', async (scope) => {
    modelLists = Object.fromEntries(
      types.map((type) => [
        type,
        [
          createModel({
            provider: `${type}-provider`,
            models: [createModelItem({ model: `${type}-model`, model_type: type })],
          }),
        ],
      ]),
    )
    const user = userEvent.setup()
    const { queryClient } = renderWithConsoleQuery(
      <ModelParameterModal {...defaults} scope={scope} />,
    )
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    await user.click(modelTrigger())
    const popup = within(
      await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
    )
    for (const type of types) {
      const option = popup.queryByRole('button', { name: new RegExp(`${type}-model`) })
      if (scope === 'all' || scope === type) expect(option).toBeInTheDocument()
      else expect(option).not.toBeInTheDocument()
    }
  })

  it('updates available models when the scope changes', async () => {
    modelLists[ModelTypeEnum.tts] = [
      createModel({ models: [createModelItem({ model: 'tts-1', model_type: ModelTypeEnum.tts })] }),
    ]
    const user = userEvent.setup()
    const { rerender } = renderWithConsoleQuery(<ModelParameterModal {...defaults} />)
    await user.click(modelTrigger())
    await screen.findByRole('button', { name: /gpt-4/ })
    rerender(<ModelParameterModal {...defaults} scope="tts" />)
    await screen.findByRole('button', { name: /tts-1/ })
    expect(screen.queryByRole('button', { name: /gpt-4/ })).not.toBeInTheDocument()
  })

  it.each([
    { value: null, readonly: false, status: ModelStatusEnum.active },
    { value: { provider: 'openai' }, readonly: false, status: ModelStatusEnum.active },
    { value: { model: 'gpt-4' }, readonly: false, status: ModelStatusEnum.active },
    {
      value: { ...selected, model: 'removed-model' },
      readonly: false,
      status: ModelStatusEnum.active,
    },
    { value: selected, readonly: true, status: ModelStatusEnum.active },
    { value: selected, readonly: false, status: ModelStatusEnum.disabled },
  ])(
    'disables settings for unavailable or readonly selections: %j',
    async ({ value, readonly, status }) => {
      modelLists[ModelTypeEnum.textGeneration]![0]!.models[0]!.status = status
      const { queryClient } = renderWithConsoleQuery(
        <ModelParameterModal {...defaults} value={value} readonly={readonly} />,
      )
      await waitFor(() => expect(queryClient.isFetching()).toBe(0))
      expect(settings()).toBeDisabled()
      expect(modelTrigger().hasAttribute('disabled')).toBe(readonly)
    },
  )

  it.each([false, true])(
    'retains compatible parameters and reports removed values (advanced: %s)',
    async (isAdvancedMode) => {
      const user = userEvent.setup()
      const setModel = vi.fn()
      renderWithConsoleQuery(
        <ModelParameterModal
          {...defaults}
          isAdvancedMode={isAdvancedMode}
          value={{ completion_params: { temperature: 0.5, unsupported: 2, stop: ['END'] } }}
          setModel={setModel}
        />,
      )
      await user.click(modelTrigger())
      await user.click(await screen.findByRole('button', { name: /gpt-4/ }))
      await waitFor(() =>
        expect(setModel).toHaveBeenCalledExactlyOnceWith({
          ...selected,
          completion_params: { temperature: 0.5, ...(isAdvancedMode ? { stop: ['END'] } : {}) },
        }),
      )
      expect(requests.rules).toHaveBeenCalledExactlyOnceWith({
        params: { provider: 'openai' },
        query: { model: 'gpt-4' },
      })
      expect(requests.warning).toHaveBeenCalledWith(
        expect.stringContaining('unsupported (unsupported)'),
      )
      expect(requests.warning.mock.calls[0]![0].includes('stop (unsupported)')).toBe(
        !isAdvancedMode,
      )
    },
  )

  it('still selects a model with empty parameters if its rules cannot be fetched', async () => {
    const user = userEvent.setup()
    const setModel = vi.fn()
    requests.rules.mockRejectedValue(new Error('Rules unavailable'))
    renderWithConsoleQuery(<ModelParameterModal {...defaults} setModel={setModel} />)
    await user.click(modelTrigger())
    await user.click(await screen.findByRole('button', { name: /gpt-4/ }))
    await waitFor(() =>
      expect(setModel).toHaveBeenCalledWith({ ...selected, completion_params: {} }),
    )
    expect(requests.error).toHaveBeenCalledExactlyOnceWith('common.error')
  })

  it('selects a non-LLM model without fetching completion parameter rules', async () => {
    const user = userEvent.setup()
    const setModel = vi.fn()
    modelLists[ModelTypeEnum.tts] = [
      createModel({ models: [createModelItem({ model: 'tts-1', model_type: ModelTypeEnum.tts })] }),
    ]
    renderWithConsoleQuery(<ModelParameterModal {...defaults} scope="tts" setModel={setModel} />)
    await user.click(modelTrigger())
    await user.click(await screen.findByRole('button', { name: /tts-1/ }))
    expect(setModel).toHaveBeenCalledExactlyOnceWith({
      provider: 'openai',
      model: 'tts-1',
      model_type: 'tts',
    })
    expect(requests.rules).not.toHaveBeenCalled()
  })

  it('updates completion parameters through the real panel while retaining model identity', async () => {
    const user = userEvent.setup()
    const setModel = vi.fn()
    renderWithConsoleQuery(
      <ModelParameterModal
        {...defaults}
        value={{ ...selected, completion_params: { max_tokens: 200 } }}
        setModel={setModel}
      />,
    )
    await waitFor(() => expect(settings()).toBeEnabled())
    await user.click(settings())
    await user.click(await screen.findByRole('switch', { name: 'Temperature' }))
    expect(setModel).toHaveBeenCalledExactlyOnceWith({
      ...selected,
      completion_params: { max_tokens: 200, temperature: 0.7 },
    })
  })

  it('edits TTS settings without any configured LLM and preserves model identity and language', async () => {
    const user = userEvent.setup()
    const setModel = vi.fn()
    modelLists = {
      [ModelTypeEnum.tts]: [
        createModel({
          models: [
            createModelItem({
              model: 'tts-1',
              model_type: ModelTypeEnum.tts,
              model_properties: {
                voices: [
                  { mode: 'alloy', name: 'Alloy' },
                  { mode: 'echo', name: 'Echo' },
                ],
              },
            }),
          ],
        }),
      ],
    }
    const value = {
      provider: 'openai',
      model: 'tts-1',
      model_type: 'tts',
      language: 'en-US',
      voice: 'alloy',
    }
    renderWithConsoleQuery(
      <ModelParameterModal {...defaults} scope="tts" value={value} setModel={setModel} />,
    )
    await waitFor(() => expect(settings()).toBeEnabled())
    await user.click(settings())
    await user.click(
      await screen.findByRole('combobox', { name: 'appDebug.voice.voiceSettings.voice' }),
    )
    await user.click(await screen.findByRole('option', { name: 'Echo' }))
    expect(setModel).toHaveBeenCalledExactlyOnceWith({ ...value, voice: 'echo' })
  })
})
