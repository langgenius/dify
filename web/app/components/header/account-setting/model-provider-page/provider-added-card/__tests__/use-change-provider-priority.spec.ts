import type { ModelProvider } from '../../declarations'
import { act, waitFor } from '@testing-library/react'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import {
  ConfigurationMethodEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '../../declarations'
import { useChangeProviderPriority } from '../use-change-provider-priority'

const changePriority = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.preferredProviderType.post': (input) =>
        changePriority(input),
    }),
  }
})

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider =>
  ({
    provider: 'langgenius/openai/openai',
    configurate_methods: [
      ConfigurationMethodEnum.customizableModel,
      ConfigurationMethodEnum.predefinedModel,
    ],
    supported_model_types: [ModelTypeEnum.textGeneration, ModelTypeEnum.textEmbedding],
    label: { en_US: 'OpenAI' },
    icon_small: { en_US: 'https://example.com/icon.png' },
    provider_credential_schema: { credential_form_schemas: [] },
    model_credential_schema: {
      model: {
        label: { en_US: 'Model' },
        placeholder: { en_US: 'Select model' },
      },
      credential_form_schemas: [],
    },
    ...overrides,
  }) as ModelProvider

function setup() {
  const view = renderHook(() => useChangeProviderPriority(createProvider()))
  const keys = [
    consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
      input: { params: { provider: 'langgenius/openai/openai' } },
    }),
    consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(),
    consoleQuery.workspaces.current.modelProviders.get.queryKey(),
    ...['llm', 'text-embedding'].map((model_type) =>
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type } },
      }),
    ),
  ]
  keys.forEach((key) => view.queryClient.setQueryData(key, { data: [] }))
  const unrelated = consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
    input: { params: { provider: 'other' } },
  })
  view.queryClient.setQueryData(unrelated, { data: [] })
  return { ...view, keys, unrelated }
}
beforeEach(() => {
  vi.resetAllMocks()
  changePriority.mockResolvedValue({ result: 'success' })
})

it('submits provider preference and invalidates its models and supported model lists', async () => {
  const { result, queryClient, keys, unrelated } = setup()
  act(() => result.current.handleChangePriority(PreferredProviderTypeEnum.custom))
  await waitFor(() => expect(queryClient.getQueryState(keys[0]!)?.isInvalidated).toBe(true))
  expect(changePriority).toHaveBeenCalledWith({
    params: { provider: 'langgenius/openai/openai' },
    body: { preferred_provider_type: PreferredProviderTypeEnum.custom },
  })
  keys.forEach((key) => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true))
  expect(queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false)
})

it('does not submit an empty provider identifier', () => {
  const { result } = renderHook(() => useChangeProviderPriority(undefined))
  act(() => result.current.handleChangePriority(PreferredProviderTypeEnum.system))
  expect(changePriority).not.toHaveBeenCalled()
})

it('reports a failed preference change without invalidating model caches', async () => {
  changePriority.mockRejectedValue(new Error('network error'))
  const notify = vi.spyOn(toast, 'error')
  const { result, queryClient, keys } = setup()
  act(() => result.current.handleChangePriority(PreferredProviderTypeEnum.custom))
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully'),
  )
  keys.forEach((key) => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false))
  expect(result.current.isChangingPriority).toBe(false)
})

it('exposes pending state until the preference is saved', async () => {
  const response = createDeferred<{ result: string }>()
  changePriority.mockReturnValue(response.promise)
  const { result } = setup()
  act(() => result.current.handleChangePriority(PreferredProviderTypeEnum.custom))
  await waitFor(() => expect(result.current.isChangingPriority).toBe(true))
  await act(async () => response.resolve({ result: 'success' }))
  await waitFor(() => expect(result.current.isChangingPriority).toBe(false))
})
